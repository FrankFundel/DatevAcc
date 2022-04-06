const axios = require("axios");
var moment = require("moment-timezone");

var hostname = "http://192.168.100.12:58454/";
var client = { id: "b2a79445-1706-42b5-b136-8db57c8cad16" };
let fiscalYear = "20210101";

const options = {
  responseType: "json",
  auth: {
    username: "spedadmin",
    password: "FixMaster.1",
  },
  headers: {
    Accept: "application/json;charset=utf-8",
    "Content-Type": "application/json;charset=utf-8",
  },
};

const run = async () => {
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

  const getDateString = (month) => {
    let d = new Date(parseInt(fiscalYear), month, 1, 0);
    return moment(d).tz("Europe/Berlin").format();
  };

  //let cmd = "date ge " + getDateString(5) + " and date le " + getDateString(6);
  let cmd = "date ge 2021-06-01T00:00:00+00:00 and date le 2021-07-01T00:00:00+00:00";
  //let cmd = "account_number eq 48220000";
  let postings = await getPostings(cmd);
  console.log(cmd, postings.length);
  postings.forEach(post => {
    if (post.account_number == 48220000) {
      console.log("FOUND 1", post.date, post.accounting_sequence_id, post.amount_debit);
    }
    if (post.accounting_sequence_id == "06-2021/0010-1") {
      console.log("FOUND 2");
    }
    if (post.account_number == 48220000 && post.accounting_sequence_id == "06-2021/0010-1") {
      console.log("FOUND 3");
    }
  });
}
run();

// Check for:
// Accounting_sequence_id = 06-2021/0010
// Account_Number = 48220000
