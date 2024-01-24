const mysql = require('mysql');
const config = require('./config.js');

const connection = mysql.createConnection(config);

const contractTableMapping = [
  {
    address: config.timelockContract1Address,
    tableName: 'timelock_contract_1',
    abiPath: './contract1.abi',
    creationBlock: config.timelockContract1CreationBlock,
  },
  {
    address: config.timelockContract2Address,
    tableName: 'timelock_contract_2',
    abiPath: './contract2.abi',
    creationBlock: config.timelockContract2CreationBlock,
  },
  {
    address: config.timelockRewardReserveContractAddress,
    tableName: 'timelock_reward_reserve_contract',
    abiPath: './timelockrewardsreserve.abi',
    creationBlock: config.timelockRewardReserveCreationBlock,
  },
  {
    address: config.tokenContractAddress,
    tableName: 'token_contract',
    abiPath: './tokencontract.abi',
    creationBlock: config.tokenContractCreationBlock,
  },
  // Add more contract addresses and table names as needed
];

function createTables() {
  for (const contract of contractTableMapping) {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS ${contract.tableName} (
        address VARCHAR(42) PRIMARY KEY,
        totalFrozen BIGINT UNSIGNED,
        totalUnfrozen BIGINT UNSIGNED,
        netAmount BIGINT UNSIGNED,
        blockNumber INT UNSIGNED,
        isTotal BOOLEAN NOT NULL DEFAULT FALSE
      );
    `;

    connection.query(createTableQuery, (err) => {
      if (err) {
        console.error(`Error creating table for ${contract.tableName}:`, err);
      } else {
	      
        console.log(`Table for ${contract.tableName} created or already exists.`);
      }
    });
  }
}

createTables();


function clearTable() {
for (const contract of contractTableMapping) {
const truncateTableQuery = `TRUNCATE TABLE ${contract.tableName};`;
  connection.query(truncateTableQuery, (err) => {
    if (err) throw err;
    console.log('Table data cleared.');
  });
}
}

clearTable();


// Import the Web3 module using destructuring
const { Web3 } = require('web3');
const fs = require('fs');

function createWebSocketProvider(url) {
    let provider = new Web3.providers.WebsocketProvider(url);

    provider.on('connect', () => console.log('WS Connected'));
    provider.on('end', (e) => {
        console.log('WS Disconnected', e);
        setTimeout(() => {
            provider = createWebSocketProvider(url); // Attempt to reconnect
            web3.setProvider(provider);
        }, 5000); // Reconnect after 5 seconds
    });

    return provider;
}

const wsProvider = new Web3.providers.WebsocketProvider(config.infuraUrl);
const web3 = new Web3(wsProvider);

async function pollEvents() {
  clearTable();

  for (const contractConfig of contractTableMapping) {
    try {
      const latest = await web3.eth.getBlockNumber();
      const contractABI = JSON.parse(fs.readFileSync(contractConfig.abiPath, 'utf-8'));
      const contract = new web3.eth.Contract(contractABI, contractConfig.address);

      if (contractConfig.tableName === 'timelock_contract_1' || contractConfig.tableName === 'timelock_contract_2') {
        const frozenEvents = await contract.getPastEvents('TokensFrozen', {
          fromBlock: contractConfig.creationBlock, // Adjust as needed
          toBlock: latest,
        });

        const unfrozenEvents = await contract.getPastEvents('TokensUnfrozen', {
          fromBlock: contractConfig.creationBlock, // Adjust as needed
          toBlock: latest,
        });
frozenEvents.forEach(event => handleEvent('TokensFrozen', event, contractConfig.tableName, latest, contract));
unfrozenEvents.forEach(event => handleEvent('TokensUnfrozen', event, contractConfig.tableName, latest, contract));
}

      // Update the total row after processing events for each contract
      updateTotalRow(contractConfig.tableName, latest, contract);
    } catch (error) {
      console.error('Error polling events for contract:', contractConfig.address, error);
    }
  }
}

/*
function handleEvent(eventType, event, tableName, blockNumber, contract) {
  const { addr, amt } = event.returnValues;
  const amtInBSOV = BigInt(amt) / BigInt(100000000); // Convert amt to BSOV
  let sql;

  if (eventType === 'TokensFrozen') {
    sql = `INSERT INTO ${tableName} (address, totalFrozen, totalUnfrozen, blockNumber) 
           VALUES ('${addr}', ${amtInBSOV}, 0, ${blockNumber}) 
           ON DUPLICATE KEY UPDATE totalFrozen = totalFrozen + ${amtInBSOV}`;
  } else if (eventType === 'TokensUnfrozen') {
    sql = `INSERT INTO ${tableName} (address, totalFrozen, totalUnfrozen, blockNumber) 
           VALUES ('${addr}', 0, ${amtInBSOV}, ${blockNumber}) 
           ON DUPLICATE KEY UPDATE totalUnfrozen = totalUnfrozen + ${amtInBSOV}`;
  }

  connection.query(sql, (err) => {
    if (err) throw err;
    console.log(`${eventType} event processed for contract ${tableName}, address: ${addr}`);
  });
}
*/

function handleEvent(eventType, event, tableName, blockNumber, contract) {
  const { addr, amt } = event.returnValues;
  // Convert amt to BSOV, rounding to the nearest whole number to avoid decimals
  const amtInBSOV = Math.round(Number(amt) / 1e8);

  let sql;

  if (eventType === 'TokensFrozen') {
    sql = `INSERT INTO ${tableName} (address, totalFrozen, totalUnfrozen, blockNumber)
           VALUES ('${addr}', ${amtInBSOV}, 0, ${blockNumber})
           ON DUPLICATE KEY UPDATE totalFrozen = totalFrozen + ${amtInBSOV}`;
  } else if (eventType === 'TokensUnfrozen') {
    sql = `INSERT INTO ${tableName} (address, totalFrozen, totalUnfrozen, blockNumber)
           VALUES ('${addr}', 0, ${amtInBSOV}, ${blockNumber})
           ON DUPLICATE KEY UPDATE totalUnfrozen = totalUnfrozen + ${amtInBSOV}`;
  }

  connection.query(sql, (err) => {
    if (err) throw err;
    console.log(`${eventType} event processed for contract ${tableName}, address: ${addr}`);
  });
}



function updateTotalRow(tableName, blockNumber, contract) {
  const totalSql = `
      INSERT INTO ${tableName} (address, totalFrozen, totalUnfrozen, netAmount, blockNumber, isTotal)
      SELECT 'TOTAL', SUM(totalFrozen), SUM(totalUnfrozen), SUM(totalFrozen) - SUM(totalUnfrozen), ${blockNumber}, TRUE FROM ${tableName}
      ON DUPLICATE KEY UPDATE 
          totalFrozen = VALUES(totalFrozen),
          totalUnfrozen = VALUES(totalUnfrozen),
          netAmount = VALUES(netAmount),
          blockNumber = VALUES(blockNumber);
  `;

  const individualSql = `
      UPDATE ${tableName} 
      SET netAmount = totalFrozen - totalUnfrozen
      WHERE address != 'TOTAL';
  `;

  connection.query(totalSql, (err) => {
    if (err) throw err;
    console.log(`Total row updated for contract ${tableName}.`);

    // After updating the "TOTAL" row, update the netAmount for individual rows
    connection.query(individualSql, (err) => {
      if (err) throw err;
      console.log(`NetAmount updated for individual rows of contract ${tableName}.`);
    });
  });
}

pollEvents();
// Poll every 60 seconds (adjust as needed)
setInterval(pollEvents, 60000);

