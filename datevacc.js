const axios = require("axios");
var readlineSync = require("readline-sync");
var fs = require("fs");
var sqlite3 = require("sqlite3").verbose();
const cliProgress = require("cli-progress");
var moment = require("moment-timezone");

const configPath = "./config.json";
const dbPath = "./database.db";

const main = async () => {
  try {
    var data = "{}";
    if (fs.existsSync(configPath)) {
      data = fs.readFileSync(configPath);
    }
    var { hostname, username, password, clientid, fiscalYear } =
      JSON.parse(data);

    if (!hostname) {
      hostname = readlineSync.question("Wie lautet die Server-Adresse? ");
    }
    if (!username) {
      username = readlineSync.question("Wie lautet der Nutzername? ");
    }
    if (!password) {
      password = readlineSync.question("Wie lautet das Passwort? ", {
        hideEchoBack: true,
      });
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

    if (!clientid) {
      var clientRes = await axios.get(
        hostname + "datev/api/accounting/v1/clients/",
        options
      );
      if (clientRes.status == 200) {
        var clients = clientRes.data;
        var clientNames = clients.map((c) => c.name);
        var cIndex = readlineSync.keyInSelect(
          clientNames,
          "Welcher client soll verwendet werden?"
        );
        clientid = clients[cIndex].id;
        console.log("Client ID: ", clientid);
      }
    }

    if (!fiscalYear) {
      var fiscalYearIds = [];
      var fiscalRes = await axios.get(
        hostname +
          "datev/api/accounting/v1/clients/" +
          clientid +
          "/fiscal-years",
        options
      );
      if (fiscalRes.status == 200) {
        var fiscalYears = fiscalRes.data;
        fiscalYearIds = fiscalYears.map((f) => f.id.substr(0, 4));
      }
      var fIndex = readlineSync.keyInSelect(
        fiscalYearIds,
        "Welches Fiskaljahr soll verwendet werden?"
      );
      fiscalYear = fiscalYearIds[fIndex];
    }

    data = JSON.stringify({
      hostname,
      username,
      password,
      clientid,
      fiscalYear,
    });
    fs.writeFile(configPath, data, (err) => {
      if (err) {
        console.log("Fehler beim Schreiben der Konfiguration.");
        console.log(err.message);
        return;
      }
      console.log("Konfiguration wurde gespeichert.");

      console.log("Verwendetes Fiskaljahr:", fiscalYear.substr(0, 4));

      // read account postings
      let db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          return console.error(err.message);
        }
        console.log("Mit der SQlite Datenbank verbunden.");
      });

      db.serialize(async () => {
        db.run(
          "CREATE TABLE IF NOT EXISTS account_postings (id TEXT UNIQUE, date DATE, content TEXT)"
        );

        // get last entry date from database
        var lastDate;
        db.get(
          "SELECT date FROM account_postings ORDER BY date DESC",
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
                  clientid +
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

            const prog = new cliProgress.SingleBar(
              {},
              cliProgress.Presets.shades_classic
            );

            const addPostings = (p, inc = true) => {
              for (let post of p) {
                db.run(
                  "INSERT INTO account_postings (id, date, content) VALUES (?, ?, ?)",
                  [post.id, post.date, JSON.stringify(post)],
                  (err) => {
                    if (err) {
                      // Already inserted.
                    }
                  }
                );
                if (inc) prog.increment(1);
              }
            };

            if (lastDate && moment().diff(moment(lastDate), "months") < 1) {
              const postings = await getPostings("date ge " + lastDate);

              prog.start(postings.length, 0);
              db.run("begin transaction");
              addPostings(postings);
              db.run("commit");
            } else {
              let today = new Date();
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

            // Close connection
            db.close((err) => {
              prog.stop();
              if (err) {
                return console.error(err.message);
              }
              console.log("Datenbankverbindung geschlossen.");
            });
          }
        );
      });
    });
  } catch (err) {
    console.log("Fehler beim Lesen der Konfiguration.");
    console.log(err);
  }
};

main();
