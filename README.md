# DatevAcc

Console tool for loading Datev account postings in local SQLite Database of type .db

# Documentation

## Installation

git clone project
cd DatecAcc
npm install

## Usage

1. node datevacc.js
2. Enter hostname (http://server:port/)
3. Enter username and password
4. Select clients to be retrieved
5. The tool starts downloaded all account postings from all fiscal years

## More

- node datevacc.js thisyear
- node datevacc.js lastyear
- node datevacc.js startat [year]
