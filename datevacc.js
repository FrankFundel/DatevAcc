const axios = require("axios");
var inquirer = require("inquirer");
var fs = require("fs");
var sqlite3 = require("sqlite3").verbose();
const cliProgress = require("cli-progress");
var moment = require("moment-timezone");

const configPath = "./config.json";
const dbPath = "./database.db";

const account_postings_schema = `(id TEXT UNIQUE, date DATE, account_number INT, accounting_sequence_id TEXT, 
  amount_debit DECIMAL(10, 2), amount_credit DECIMAL(10, 2), contra_account_number INT, posting_description TEXT, 
  tax_key INT, tax_rate DECIMAL(10, 2), kost1_cost_center_id TEXT, kost2_cost_center_id TEXT, is_opening_balance_posting BOOL)`;

const account_postings = `(id, date, account_number, accounting_sequence_id, 
    amount_debit, amount_credit, contra_account_number, posting_description, 
    tax_key, tax_rate, kost1_cost_center_id, kost2_cost_center_id, is_opening_balance_posting)`;

const main = async () => {
  try {
    var data = "{}";
    if (fs.existsSync(configPath)) {
      data = fs.readFileSync(configPath);
    }
    var { hostname, username, password, clients } = JSON.parse(data);

    var questions = [];

    if (!hostname) {
      hostname = (
        await inquirer.prompt({
          type: "input",
          name: "hostname",
          message: "Wie lautet die Server-Adresse?",
        })
      ).hostname;
      if (!hostname.startsWith("http")) hostname = "http://" + hostname;
      if (!hostname.endsWith("/")) hostname += "/";
    }
    if (!username) {
      username = (
        await inquirer.prompt({
          type: "input",
          name: "username",
          message: "Wie lautet der Nutzername?",
        })
      ).username;
    }
    if (!password) {
      password = (
        await questions.push({
          type: "password",
          name: "password",
          message: "Wie lautet das Passwort?",
        })
      ).password;
    }

    const options = {
      responseType: "json",
      auth: {
        username,
        password,
      },
      headers: {
        Accept: "application/json;charset=utf-8",
        "Content-Type": "application/json;charset=utf-8",
      },
    };

    if (!clients) {
      var clientRes = await axios.get(
        hostname + "datev/api/accounting/v1/clients/",
        options
      );
      if (clientRes.status == 200) {
        var clts = clientRes.data;
        var clientObject = {};
        clts.forEach((c) => {
          clientObject[c.name] = { name: c.name, id: c.id };
        });

        var selectedClients = (
          await inquirer.prompt({
            type: "checkbox",
            name: "selectedClients",
            message: "Welcher Klienten sollen verwendet werden?",
            choices: Object.keys(clientObject),
          })
        ).selectedClients;

        clients = selectedClients.map((c) => clientObject[c]);
        console.log("Client IDs: ", clients);
      }
    }

    data = JSON.stringify({
      hostname,
      username,
      password,
      clients,
    });
    fs.writeFile(configPath, data, async (err) => {
      if (err) {
        console.log("Fehler beim Schreiben der Konfiguration.");
        console.log(err.message);
        return;
      }
      console.log("Konfiguration wurde gespeichert.");

      // Start of the routine
      let db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          return console.error(err.message);
        }
        console.log("Mit der SQlite Datenbank verbunden.");
      });

      const doProcedure = async (client, fiscalYear) => {
        return new Promise((resolve, reject) => {
          const prog = new cliProgress.SingleBar(
            {},
            cliProgress.Presets.shades_classic
          );

          db.serialize(async () => {
            db.run(
              "CREATE TABLE IF NOT EXISTS '" +
                client.name +
                "' " +
                account_postings_schema
            );

            // get last entry date from database
            var lastDate;
            db.get(
              "SELECT date FROM '" + client.name + "' ORDER BY date DESC",
              async (err, row) => {
                if (row) lastDate = row.date;
                console.log("Letzter Eintrag: ", lastDate);

                // get postings after this date
                const getPostings = async (date) => {
                  var postings = [];
                  var postingOptions = { ...options };
                  postingOptions.params = { filter: date };

                  var postingRes = await axios.get(
                    hostname +
                      "datev/api/accounting/v1/clients/" +
                      client.id +
                      "/fiscal-years/" +
                      fiscalYear +
                      "/account-postings",
                    postingOptions
                  );
                  if (postingRes.status == 200) {
                    postings = postingRes.data;
                  }
                  return postings;
                };

                const addPostings = (p, inc = true) => {
                  for (let post of p) {
                    db.run(
                      "INSERT INTO '" +
                        client.name +
                        "' " +
                        account_postings +
                        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                      [
                        post.id,
                        post.date,
                        post.account_number,
                        post.accounting_sequence_id,
                        post.amount_debit,
                        post.amount_credit,
                        post.contra_account_number,
                        post.posting_description,
                        post.advance_payment
                          ? post.advance_payment.tax_key
                          : null,
                        post.tax_rate,
                        post.kost1_cost_center_id,
                        post.kost2_cost_center_id,
                        post.is_opening_balance_posting,
                      ],
                      (err) => {
                        if (err) {
                          // Already inserted.
                        }
                      }
                    );
                    if (inc) prog.increment(1);
                  }
                };

                // Postings vom letzten monat auf ein mal holen
                if (lastDate && moment().diff(moment(lastDate), "months") < 1) {
                  const postings = await getPostings("date ge " + lastDate);

                  prog.start(postings.length, 0);
                  db.run("begin transaction");
                  addPostings(postings);
                  db.run("commit");
                } else {
                  // Postings in monate zerstückelt holen
                  const getDateString = (month) => {
                    let d = new Date(
                      parseInt(fiscalYear.substr(0, 4)),
                      month,
                      1,
                      0
                    );
                    return moment(d).tz("Europe/Berlin").format();
                  };

                  // if last date is present and in the same fiscal year, start at that month from beginning
                  let start = 0;
                  if (
                    lastDate &&
                    new Date(lastDate).getFullYear() ==
                      parseInt(fiscalYear.substr(0, 4))
                  )
                    start = new Date(lastDate).getMonth();

                  console.log(
                    "Letzter Eintrag zu lange her, starte ab Monat",
                    start
                  );

                  prog.start(12, start);
                  for (let month = 0; month <= 11; month++) {
                    db.run("begin transaction");
                    let postings = await getPostings(
                      "date ge " +
                        getDateString(month, 1) +
                        " and date le " +
                        getDateString(month + 1, 1)
                    );
                    addPostings(postings, false);
                    prog.increment(1);
                    await new Promise((resolve, reject) => {
                      db.run("commit", (err) => {
                        if (err) return reject();
                        resolve();
                      });
                    });
                  }
                }

                resolve();
                prog.stop();
              }
            );
          });
        });
      };

      // For each client
      for (let client of clients) {
        console.log("Verwendeter Klient:", client.name);

        // Get fiscal years
        var fiscalYearIds = [];
        var fiscalRes = await axios.get(
          hostname +
            "datev/api/accounting/v1/clients/" +
            client.id +
            "/fiscal-years",
          options
        );
        if (fiscalRes.status == 200) {
          var fiscalYears = fiscalRes.data;
          fiscalYearIds = fiscalYears.map((f) => f.id);
        }

        // For each fiscal year
        for (let fiscalYear of fiscalYearIds) {
          console.log("Verwendetes Fiskaljahr:", fiscalYear.substr(0, 4));

          // read account postings
          await doProcedure(client, fiscalYear);
        }
      }

      // Close connection
      db.close((err) => {
        if (err) {
          return console.error(err.message);
        }
        console.log("Datenbankverbindung geschlossen.");
      });
    });
  } catch (err) {
    console.log("Fehler beim Lesen der Konfiguration.");
    console.log(err);
  }
};

main();
