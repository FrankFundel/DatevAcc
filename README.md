# DatevAcc

- Console tool for loading Datev account postings in local SQLite Database of type .db
- Saves the last entry and downloads only the new entries since the last one.
- Has a config.json for server and login information and fiscal year (has to be changed every new year).

# Notice

- If more then one month lies between the last entry and today, the download gets split into parts.
- If last entry is not in the same fiscal year, the download starts from the beginning of the stored fiscal year.
