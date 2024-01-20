const mysql = require('mysql');
const config = require('./config.js');

const connection = mysql.createConnection(config);

const createTableQuery = `
    CREATE TABLE IF NOT EXISTS timelock_token_balances (
        address VARCHAR(42) PRIMARY KEY,
        totalFrozen BIGINT UNSIGNED,
        totalUnfrozen BIGINT UNSIGNED,
        netAmount BIGINT UNSIGNED,
	isTotal BOOLEAN NOT NULL DEFAULT FALSE
	
    );
`;

connection.query(createTableQuery, (err) => {
    if (err) throw err;
    console.log('Table created or already exists.');
});

const truncateTableQuery = `TRUNCATE TABLE timelock_token_balances;`;

connection.query(truncateTableQuery, (err) => {
    if (err) throw err;
    console.log('Table data cleared.');
});



// Import the Web3 module using destructuring
const { Web3 } = require('web3');
const fs = require('fs');

// Initialize the Web3 instance with your Ethereum node endpoint
const web3 = new Web3();
web3.setProvider(new web3.providers.WebsocketProvider(config.infuraUrl));


// Load your contract's ABI from a file
const abiPath = './contract1.abi'; // Path to ABI file
const tokenContractABI = JSON.parse(fs.readFileSync(abiPath, 'utf-8'));

/*
// Define your contract's deployed address
const tokenContractAddress = '0x19E6BF254aBf5ABC925ad72d32bac44C6c03d3a4';
*/

// Create a contract instance
const contract = new web3.eth.Contract(tokenContractABI, config.tokenContractAddress);

// console.log(contract);


const eventSignature = web3.utils.sha3('TokensFrozen(address,uint256,uint256)');
console.log(eventSignature);


async function pollEvents() {
    try {
        const latest = await web3.eth.getBlockNumber();
        const frozenEvents = await contract.getPastEvents('TokensFrozen', {
            fromBlock: 8272361, // Adjust as needed
            toBlock: 'latest'
        });

        const unfrozenEvents = await contract.getPastEvents('TokensUnfrozen', {
            fromBlock: 8272361, // Adjust as needed
            toBlock: 'latest'
        });

        frozenEvents.forEach(event => handleEvent('TokensFrozen', event));
        unfrozenEvents.forEach(event => handleEvent('TokensUnfrozen', event));

        // Update the total row after all individual events have been processed
        updateTotalRow();
    } catch (error) {
        console.error('Error polling events:', error);
    }
}




function handleEvent(eventType, event) {
    const { addr, amt } = event.returnValues;
    const amtInBSOV = BigInt(amt) / BigInt(100000000); // Convert amt to BSOV
    let sql;

    if (eventType === 'TokensFrozen') {
        sql = `INSERT INTO timelock_token_balances (address, totalFrozen, totalUnfrozen) 
               VALUES ('${addr}', ${amtInBSOV}, 0) 
               ON DUPLICATE KEY UPDATE totalFrozen = totalFrozen + ${amtInBSOV}`;
    } else if (eventType === 'TokensUnfrozen') {
        sql = `INSERT INTO timelock_token_balances (address, totalFrozen, totalUnfrozen) 
               VALUES ('${addr}', 0, ${amtInBSOV}) 
               ON DUPLICATE KEY UPDATE totalUnfrozen = totalUnfrozen + ${amtInBSOV}`;
    }

    connection.query(sql, (err) => {
        if (err) throw err;
        console.log(`${eventType} event processed for address: ${addr}`);
    });
}


function updateTotalRow() {
    const totalSql = `
        INSERT INTO timelock_token_balances (address, totalFrozen, totalUnfrozen, netAmount, isTotal)
        SELECT 'TOTAL', SUM(totalFrozen), SUM(totalUnfrozen), SUM(totalFrozen) - SUM(totalUnfrozen), TRUE FROM timelock_token_balances
        ON DUPLICATE KEY UPDATE 
            totalFrozen = VALUES(totalFrozen),
            totalUnfrozen = VALUES(totalUnfrozen),
            netAmount = VALUES(netAmount);
    `;

    connection.query(totalSql, (err) => {
        if (err) throw err;
        console.log(`Total row updated.`);
    });
}




pollEvents();
// Poll every 36000 seconds (10 hours) (adjust as needed)
setInterval(pollEvents, 36000000);

