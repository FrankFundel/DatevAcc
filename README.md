# DatevAcc

Console tool for loading Datev account postings in a Azure SQL Database.
For security reasons, every user should user their own database for their customers.

SET QUOTED_IDENTIFIER ON

# Documentation

## Installation

1. git clone project
2. cd DatecAcc
3. npm install

## Usage

1. node datevacc.js
2. Enter hostname (http://server:port/)
3. Enter username and password
4. Select clients to be retrieved
5. Enter SQL Data
6. The tool starts downloading all account postings from all fiscal years

## More

- node datevacc.js thisyear
- node datevacc.js lastyear
- node datevacc.js startat [year]
