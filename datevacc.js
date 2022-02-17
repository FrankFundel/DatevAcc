const axios = require("axios");
var inquirer = require("inquirer");
var fs = require("fs");
var mysql = require("mysql2/promise");
const cliProgress = require("cli-progress");
var moment = require("moment-timezone");

const configPath = "./config.json";
const dbPath = "./database.db";

const account_postings_schema = `(id VARCHAR(20) UNIQUE, date DATE, account_number INT, accounting_sequence_id VARCHAR(20), 
  amount_debit DECIMAL(10, 2), amount_credit DECIMAL(10, 2), contra_account_number INT, posting_description VARCHAR(255), 
  tax_key INT, tax_rate DECIMAL(10, 2), kost1_cost_center_id VARCHAR(10), kost2_cost_center_id VARCHAR(10), is_opening_balance_posting BOOL)`;

const account_postings = `(id, date, account_number, accounting_sequence_id, 
    amount_debit, amount_credit, contra_account_number, posting_description, 
    tax_key, tax_rate, kost1_cost_center_id, kost2_cost_center_id, is_opening_balance_posting)`;

const main = async () => {
  try {
    var data = "{}";
    if (fs.existsSync(configPath)) {
      data = fs.readFileSync(configPath);
    }
    var {
      hostname,
      username,
      password,
      clients,
      dbHost,
      dbUser,
      dbPassword,
      dbDatabase,
    } = JSON.parse(data);

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
        await inquirer.prompt({
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

    if (!dbHost) {
      dbHost = (
        await inquirer.prompt({
          type: "input",
          name: "dbHost",
          message: "Wie lautet die MySQL-Adresse?",
        })
      ).dbHost;
    }
    if (!dbUser) {
      dbUser = (
        await inquirer.prompt({
          type: "input",
          name: "dbUser",
          message: "Wie lautet der MySQL-Nutzername?",
        })
      ).dbUser;
    }
    if (!dbPassword) {
      dbPassword = (
        await inquirer.prompt({
          type: "password",
          name: "dbPassword",
          message: "Wie lautet das MySQL-Passwort?",
        })
      ).dbPassword;
    }
    if (!dbDatabase) {
      dbDatabase = (
        await inquirer.prompt({
          type: "input",
          name: "dbDatabase",
          message: "Wie lautet die MySQL-Datenbank?",
        })
      ).dbDatabase;
    }

    data = JSON.stringify({
      hostname,
      username,
      password,
      clients,
      dbHost,
      dbUser,
      dbPassword,
      dbDatabase,
    });
    fs.writeFile(configPath, data, async (err) => {
      if (err) {
        console.warn("Fehler beim Schreiben der Konfiguration.");
        console.warn(err.message);
        return;
      }
      console.log("Konfiguration wurde gespeichert.");

      // Start of the routine
      var con = await mysql.createConnection({
        host: dbHost,
        user: dbUser,
        password: dbPassword,
        database: dbDatabase,
      });
      console.log("Mit der Datenbank verbunden.");

      const doProcedure = async (client, fiscalYear) => {
        console.info("Verwendetes Fiskaljahr:", fiscalYear.substr(0, 4));

        const prog = new cliProgress.SingleBar(
          {},
          cliProgress.Presets.shades_classic
        );

        await con.execute(
          "CREATE TABLE IF NOT EXISTS `" +
            client.id +
            "` " +
            account_postings_schema
        );

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

        const addPostings = async (p, inc = true) => {
          let dups = 0;
          for (let post of p) {
            try {
              await con.query(
                "INSERT INTO `" +
                  client.id +
                  "` " +
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
                  post.advance_payment ? post.advance_payment.tax_key : null,
                  post.tax_rate,
                  post.kost1_cost_center_id,
                  post.kost2_cost_center_id,
                  post.is_opening_balance_posting,
                ]
              );
            } catch (err) {
              if (err.code == "ER_DUP_ENTRY") {
                dups++;
                // Already inserted.
              }
            }
            if (inc) prog.increment(1);
          }

          return dups;
        };

        const getDateString = (month) => {
          let d = new Date(parseInt(fiscalYear.substr(0, 4)), month, 1, 0);
          return moment(d).tz("Europe/Berlin").format();
        };

        // if last date is present and in the same fiscal year, start at that month from beginning
        let start = 0,
          posts = 0,
          dups = 0;
        prog.start(12, start);

        for (let month = 0; month <= 11; month++) {
          await con.query("START TRANSACTION");
          let postings = await getPostings(
            "date ge " +
              getDateString(month, 1) +
              " and date le " +
              getDateString(month + 1, 1)
          );
          let d = await addPostings(postings, false);
          posts += postings.length;
          dups += d;
          prog.increment(1);
          await con.query("COMMIT");
        }

        console.log("\nPostings:", posts, "Duplikate:", dups);

        prog.stop();
      };

      // For each client
      for (let client of clients) {
        console.info("Verwendeter Klient:", client.name);

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

        const arg = process.argv[2];
        if (arg == "lastyear") {
          let fiscalYear;
          if (fiscalYearIds.length >= 2) {
            fiscalYear = fiscalYearIds[fiscalYearIds.length - 2];
            await doProcedure(client, fiscalYear);
          } else {
            console.warn("Letztes Jahr ist nicht verfügbar!");
          }
        } else if (arg == "thisyear") {
          let fiscalYear;
          if (fiscalYearIds.length >= 1) {
            fiscalYear = fiscalYearIds[fiscalYearIds.length - 1];
            await doProcedure(client, fiscalYear);
          } else {
            console.warn("Dieses Jahr ist nicht verfügbar!");
          }
        } else if (arg == "startat") {
          let startat = process.argv[3];
          if (startat) {
            var ok = false;
            for (let fiscalYear of fiscalYearIds) {
              if (fiscalYear.startsWith(startat)) ok = true;
              if (ok) await doProcedure(client, fiscalYear);
            }
          }
        } else {
          for (let fiscalYear of fiscalYearIds) {
            await doProcedure(client, fiscalYear);
          }
        }
      }

      // Close connection
      await con.end();
      console.log("Datenbankverbindung geschlossen.");
    });
  } catch (err) {
    console.warn("Fehler beim Lesen der Konfiguration.");
    console.warn(err);
  }
};

main();
