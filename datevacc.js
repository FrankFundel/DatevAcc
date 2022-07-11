import axios from "axios";
import inquirer from "inquirer";
import fs from "fs";
import mssql from "mssql";
import cliProgress from "cli-progress";
import moment from "moment-timezone";
import util from "util";

const configPath = "./config.json";

// identificator = id + accounting_sequence_id
const account_postings_schema = `(
  identificator                                           VARCHAR(39) PRIMARY KEY WITH (IGNORE_DUP_KEY = ON),
  id                                                      VARCHAR(25),
  account_number                                          INT,
  accounting_reason                                       VARCHAR(34),
  accounting_sequence_id                                  VARCHAR(14),
  accounting_transaction_key                              INT,
  accounting_transaction_key49_additional_function        INT,
  accounting_transaction_key49_main_function_number       INT,
  accounting_transaction_key49_main_function_type         INT,
  additional_functions_for_goods_and_services             INT,
  additional_information$additional_information_type      VARCHAR(7),
  additional_information$additional_information_content   VARCHAR(9),
  amount_credit                                           DECIMAL(12,2),
  amount_debit                                            DECIMAL(12,2),
  amount_entered                                          DECIMAL(12,2),
  advance_payment$eu_member_state                         VARCHAR(2),
  advance_payment$eu_tax_rate                             DECIMAL(12,2),
  advance_payment$order_number                            VARCHAR(30),
  advance_payment$record_type                             VARCHAR(2),
  advance_payment$revenue_account                         INT,
  advance_payment$tax_key                                 INT,
  billing_reference                                       VARCHAR(50),
  cash_discount_type                                      VARCHAR(50),
  cases_related_to_goods_and_services                     INT,
  contra_account_number                                   INT,
  currency_code                                           VARCHAR(3),
  currency_code_of_base_transaction_amount                VARCHAR(3),
  date                                                    DATE,
  date_assigned_tax_period                                DATE,
  delivery_date                                           DATE,
  differing_taxation_method                               VARCHAR(100),
  document_field1                                         VARCHAR(36),
  document_field2                                         VARCHAR(12),
  document_link                                           VARCHAR(210),
  eu_tax_rate                                             DECIMAL(12,2),
  eu_tax_rate_for_country_of_origin                       DECIMAL(12,2),
  eu_vat_id                                               VARCHAR(15),
  eu_vat_id_for_country_of_origin                         VARCHAR(50),
  exchange_rate                                           DECIMAL(16,6),
  general_reversal                                        BIT,
  is_opening_balance_posting                              BIT,
  kost_quantity                                           DECIMAL(16,6),
  kost1_cost_center_id                                    VARCHAR(20),
  kost2_cost_center_id                                    VARCHAR(20),
  open_item_information$assessment_year                   INT,
  open_item_information$assigned_due_date                 DATE,
  open_item_information$business_partner_bank_position    INT,
  open_item_information$circumstance_type                 INT,
  open_item_information$has_dunning_block                 BIT,
  open_item_information$has_interest_block                BIT,
  open_item_information$payment_method                    VARCHAR(20),
  open_item_information$receivable_type_id                VARCHAR(50),
  open_item_information$sepa_mandate_reference            VARCHAR(50),
  open_item_information$various_address_id                VARCHAR(50),
  mark_of_origin                                          VARCHAR(3),
  posting_description                                     VARCHAR(50),
  record_type                                             VARCHAR(30),
  tax_rate                                                DECIMAL(12,2)
)`;

const stock_takings_schema = `(
  identificator                                           VARCHAR(39) PRIMARY KEY WITH (IGNORE_DUP_KEY = ON),
  id                                                      VARCHAR(25),
  asset_number                                            INT,
  inventory_number                                        VARCHAR(15),
  accounting_reason                                       INT,
  general_ledger_account$account_number                   INT,
  general_ledger_account$caption                          VARCHAR(100),
  inventory_name                                          VARCHAR(60),
  acquisition_date                                        DATE,
  economic_lifetime                                       INT,
  kost1_cost_center_id                                    VARCHAR(20),
  branch                                                  INT,
  order_date                                              DATE,
  origin_type                                             VARCHAR(60),
  price                                                   DECIMAL(12,2),
  quantity                                                DECIMAL(12,2),
  stocktaking_date                                        DATE,
  unit                                                    VARCHAR(60),
  farmland_number                                         VARCHAR(60),
  serial_number                                           VARCHAR(60),
  location                                                VARCHAR(60),
  contract_number                                         VARCHAR(60),
  type_of_use                                             VARCHAR(60),
  _condition                                              VARCHAR(60),
  isin                                                    VARCHAR(60),
  explanation_of_depreciation                             VARCHAR(60)
)`;

const account_postings = `(identificator, id, account_number, accounting_reason, accounting_sequence_id, accounting_transaction_key,
  accounting_transaction_key49_additional_function, accounting_transaction_key49_main_function_number, accounting_transaction_key49_main_function_type,
  additional_functions_for_goods_and_services, additional_information$additional_information_type, additional_information$additional_information_content,
  amount_credit, amount_debit, amount_entered, advance_payment$eu_member_state, advance_payment$eu_tax_rate, advance_payment$order_number,
  advance_payment$record_type, advance_payment$revenue_account, advance_payment$tax_key, billing_reference, cash_discount_type, cases_related_to_goods_and_services,
  contra_account_number, currency_code, currency_code_of_base_transaction_amount, date, date_assigned_tax_period, delivery_date, differing_taxation_method,
  document_field1, document_field2, document_link, eu_tax_rate, eu_tax_rate_for_country_of_origin, eu_vat_id, eu_vat_id_for_country_of_origin, exchange_rate,
  general_reversal, is_opening_balance_posting, kost_quantity, kost1_cost_center_id, kost2_cost_center_id, open_item_information$assessment_year,
  open_item_information$assigned_due_date, open_item_information$business_partner_bank_position, open_item_information$circumstance_type,
  open_item_information$has_dunning_block, open_item_information$has_interest_block, open_item_information$payment_method, open_item_information$receivable_type_id,
  open_item_information$sepa_mandate_reference, open_item_information$various_address_id, mark_of_origin, posting_description, record_type, tax_rate)`;

const stock_takings = `(identificator, id, asset_number, inventory_number, accounting_reason, general_ledger_account$account_number, general_ledger_account$caption,
  inventory_name, acquisition_date, economic_lifetime, kost1_cost_center_id, branch, order_date, origin_type, price, quantity, stocktaking_date, unit, farmland_number,
  serial_number, location, contract_number, type_of_use, _condition, isin, explanation_of_depreciation)`;

if (!fs.existsSync("logs/")) {
  fs.mkdirSync("logs/");
}

var logFile = fs.createWriteStream(
  "logs/" + moment().format("DDMMYYYYHHmm") + ".txt",
  {
    flags: "a",
  }
);

var logContent = "";
const log = (...data) => {
  console.log(...data);
  logFile.write(util.format(...data) + "\n");
  logContent += util.format(...data) + "\n";
};

process.on("uncaughtException", function (err) {
  log(err);
  process.exit();
});

String.prototype.replaceAll = function (search, replacement) {
  var target = this;
  return target.replace(new RegExp(search, "g"), replacement);
};

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
        log("Client IDs: ", clients);
      }
    }

    if (!dbHost) {
      dbHost = (
        await inquirer.prompt({
          type: "input",
          name: "dbHost",
          message: "Wie lautet die Datenbank-Adresse?",
        })
      ).dbHost;
    }
    if (!dbUser) {
      dbUser = (
        await inquirer.prompt({
          type: "input",
          name: "dbUser",
          message: "Wie lautet der Datenbank-Nutzername?",
        })
      ).dbUser;
    }
    if (!dbPassword) {
      dbPassword = (
        await inquirer.prompt({
          type: "password",
          name: "dbPassword",
          message: "Wie lautet das Datenbank-Passwort?",
        })
      ).dbPassword;
    }
    if (!dbDatabase) {
      dbDatabase = (
        await inquirer.prompt({
          type: "input",
          name: "dbDatabase",
          message: "Wie lautet der Datenbankname?",
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
    var data = fs.writeFileSync(configPath, data);
    log("Konfiguration wurde gespeichert.");

    // Start of the routine
    var con = await mssql.connect({
      server: dbHost,
      user: dbUser,
      port: 1433,
      password: dbPassword,
      database: dbDatabase,
      options: {
        encrypt: true,
      },
      requestTimeout: 600000,
    });
    log("Mit der Datenbank verbunden.");

    await con.query(
      `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='` +
        username +
        `-log') CREATE TABLE "` +
        username +
        `-log" (id INT PRIMARY KEY IDENTITY, date DATE, log TEXT)`
    );

    const parseEntries = (entries) => {
      let entryStrings = [];
      entries.forEach((entry) => {
        entry.forEach((value, index) => {
          if (value == null) {
            entry[index] = "NULL";
          } else {
            entry[index] = "'" + value.toString().replaceAll("'", "''") + "'";
          }
        });
        entryStrings.push("(" + entry.join(", ") + ")");
      });
      return entryStrings.join(", ");
    };

    const doProcedure = async (client, fiscalYear) => {
      log("Verwendetes Fiskaljahr:", fiscalYear.substr(0, 4));

      const prog = new cliProgress.SingleBar(
        {},
        cliProgress.Presets.shades_classic
      );

      await con.query(
        `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='postings_` +
          client.id +
          `') CREATE TABLE "postings_` +
          client.id +
          `" ` +
          account_postings_schema
      );

      await con.query(
        `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='stocktakings_` +
          client.id +
          `') CREATE TABLE "stocktakings_` +
          client.id +
          `" ` +
          stock_takings_schema
      );

      // get postings between this date
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

      // get stocktakings between this date
      const getStocktakings = async (date) => {
        var stocktakings = [];
        var stocktakingOptions = { ...options };

        try {
          var stocktakingRes = await axios.get(
            hostname +
              "datev/api/accounting/v1/clients/" +
              client.id +
              "/fiscal-years/" +
              fiscalYear +
              "/assets/stocktakings",
            stocktakingOptions
          );
          if (stocktakingRes.status == 200) {
            stocktakings = stocktakingRes.data;
          }
          return stocktakings;
        } catch (err) {
          return null;
        }
      };

      const addPostings = async (request, p, inc = true) => {
        if (p.length > 0) {
          let entries = p.map((post) => [
            post.id + post.accounting_sequence_id,
            post.id,
            post.account_number,
            post.accounting_reason,
            post.accounting_sequence_id,
            post.accounting_transaction_key,
            post.accounting_transaction_key49_additional_function,
            post.accounting_transaction_key49_main_function_number,
            post.accounting_transaction_key49_main_function_type,
            post.additional_functions_for_goods_and_services,
            post.additional_information && post.additional_information[0]
              ? post.additional_information[0].additional_information_type
              : null,
            post.additional_information && post.additional_information[0]
              ? post.additional_information[0].additional_information_content
              : null,
            post.amount_credit,
            post.amount_debit,
            post.amount_entered,
            post.advance_payment ? post.advance_payment.eu_member_state : null,
            post.advance_payment ? post.advance_payment.eu_tax_rate : null,
            post.advance_payment ? post.advance_payment.order_number : null,
            post.advance_payment ? post.advance_payment.record_type : null,
            post.advance_payment ? post.advance_payment.revenue_account : null,
            post.advance_payment ? post.advance_payment.tax_key : null,
            post.billing_reference,
            post.cash_discount_type,
            post.cases_related_to_goods_and_services,
            post.contra_account_number,
            post.currency_code,
            post.currency_code_of_base_transaction_amount,
            post.date,
            post.date_assigned_tax_period,
            post.delivery_date,
            post.differing_taxation_method,
            post.document_field1,
            post.document_field2,
            post.document_link,
            post.eu_tax_rate,
            post.eu_tax_rate_for_country_of_origin,
            post.eu_vat_id,
            post.eu_vat_id_for_country_of_origin,
            post.exchange_rate,
            post.general_reversal,
            post.is_opening_balance_posting,
            post.kost_quantity,
            post.kost1_cost_center_id,
            post.kost2_cost_center_id,
            post.open_item_information
              ? post.open_item_information.assessment_year
              : null,
            post.open_item_information
              ? post.open_item_information.assigned_due_date
              : null,
            post.open_item_information
              ? post.open_item_information.business_partner_bank_position
              : null,
            post.open_item_information
              ? post.open_item_information.circumstance_type
              : null,
            post.open_item_information
              ? post.open_item_information.has_dunning_block
              : null,
            post.open_item_information
              ? post.open_item_information.has_interest_block
              : null,
            post.open_item_information
              ? post.open_item_information.payment_method
              : null,
            post.open_item_information
              ? post.open_item_information.receivable_type_id
              : null,
            post.open_item_information
              ? post.open_item_information.sepa_mandate_reference
              : null,
            post.open_item_information
              ? post.open_item_information.various_address_id
              : null,
            post.mark_of_origin,
            post.posting_description,
            post.record_type,
            post.tax_rate,
          ]);

          try {
            await request.query(
              `INSERT INTO "postings_` +
                client.id +
                `" ` +
                account_postings +
                ` SELECT * FROM (VALUES ` +
                parseEntries(entries) +
                `) AS temp ` +
                account_postings
            );
          } catch (err) {
            log("Error during postings.", err);
          }
        }
        if (inc) prog.increment(1);
      };

      const addStocktakings = async (request, s, inc = true) => {
        if (s.length > 0) {
          let entries = s.map((stock) => [
            stock.id + stock.asset_number,
            stock.id,
            stock.asset_number,
            stock.inventory_number,
            stock.accounting_reason,
            stock.general_ledger_account
              ? stock.general_ledger_account.account_number
              : null,
            stock.general_ledger_account
              ? stock.general_ledger_account.caption
              : null,
            stock.inventory_name,
            stock.acquisition_date,
            stock.economic_lifetime,
            stock.kost1_cost_center_id,
            stock.branch,
            stock.order_date,
            stock.origin_type,
            stock.price,
            stock.quantity,
            stock.stocktaking_date,
            stock.unit,
            stock.farmland_number,
            stock.serial_number,
            stock.location,
            stock.contract_number,
            stock.type_of_use,
            stock.condition,
            stock.isin,
            stock.explanation_of_depreciation,
          ]);

          try {
            await request.query(
              `INSERT INTO "stocktakings_` +
                client.id +
                `" ` +
                stock_takings +
                ` SELECT * FROM (VALUES ` +
                parseEntries(entries) +
                `) AS temp ` +
                stock_takings
            );
          } catch (err) {
            log("Error during stocktakings.", err);
          }
        }
        if (inc) prog.increment(1);
      };

      const getDateString = (y, month) => {
        let d = new Date(parseInt(fiscalYear.substr(0, 4)) + y, month, 1, 0);
        return moment(d).tz("Europe/Berlin").format();
      };

      log("Hole Bestandsaufnahmen");
      let stocktakings = await getStocktakings();
      let transaction = con.transaction();
      await transaction.begin();
      try {
        let request = transaction.request();
        if (stocktakings) await addStocktakings(request, stocktakings, false);
        await transaction.commit();
      } catch (err) {
        log("Error during stocktaking transaction", err);
        await transaction.rollback();
      }

      log("Hole Kontobuchungen");
      prog.start(12 * 3, 0);
      for (let y = -1; y <= 1; y++) {
        // look also in the year before and after in the same fiscal year
        for (let month = 0; month < 12; month++) {
          let postings = await getPostings(
            "date ge " +
              getDateString(y, month) +
              " and date le " +
              getDateString(y, month + 1)
          );
          let transaction = con.transaction();
          await transaction.begin();
          try {
            let request = transaction.request();
            await addPostings(request, postings, false);
            prog.increment(1);
            await transaction.commit();
          } catch (err) {
            log("Error during postings transaction", err);
            await transaction.rollback();
          }
        }
      }
      prog.stop();
    };

    // For each client
    for (let client of clients) {
      log("Verwendeter Klient:", client.name);

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
          log("Letztes Jahr ist nicht verfügbar!");
        }
      } else if (arg == "thisyear") {
        let fiscalYear;
        if (fiscalYearIds.length >= 1) {
          fiscalYear = fiscalYearIds[fiscalYearIds.length - 1];
          await doProcedure(client, fiscalYear);
        } else {
          log("Dieses Jahr ist nicht verfügbar!");
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
  } catch (err) {
    log(err);
  }

  // Log
  await con.query(
    `INSERT INTO "` +
      username +
      `-log" (date, log) VALUES ('` +
      moment().format("YYYY-MM-DD HH:mm:ss") +
      `', '` +
      logContent
        .replaceAll(password, "***")
        .replaceAll(dbPassword, "***")
        .replaceAll("'", "''") +
      `')`
  );
  log("Uploaded log.");

  // Close connection
  await con.close();
  log("Datenbankverbindung geschlossen.");

  // Exit
  log("Programm beendet.");
  process.exit();
};

main();
