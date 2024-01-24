Different apps that work in the background, necessary for sovcube website


You have to set up a MySQL server and create a user, a password and a database.
Then copy the config.js-sample file and rename it to config.js and fill out the info.

### Requirements:
You need Node.js version: v16.20.2 (You can install it using `nvm`.
Setup MySQL first.

To install:
- run `sudo apt install npm`
- run `npm install`

To run:
- run `cd timelock-watcher`
- run `node server.js` / or install pm2 and run `pm2 start server.js` and check logs with `pm2 logs 0`

