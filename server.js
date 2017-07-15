const config = require("./config.json");
const balanceFile = "./balance.json";

const axios = require("axios");
const jsonfile = require("jsonfile");
const math = require("mathjs");
const lisk = require("lisk-js");

const http = axios.create({
  baseURL: "http://" + config.node + ":" + config.port,
  timeout: 5000
});

function dustToLSK(dust) {
  return math.round(math.eval(`${dust} / 100000000`),4);
}

function LSKToDust(LSK) {
  return LSK * 100000000;
}

function unixTimeStamp(jsTimestamp) {
  return jsTimestamp / 1000 | 0;
}

function getTransactionFee() {
  return LSKToDust(0.1);
}

async function retrieveNewBalance(balance) {
  try {
    const newBalance = JSON.parse(JSON.stringify(balance));
    const newTimestamp = unixTimeStamp(new Date().getTime());
    const transactionsUrl = `/api/transactions?recipientId=${config.address}&AND:fromUnixTime=${newBalance.updateTimestamp}&AND:toUnixTime=${newTimestamp}&AND:limit=1000`;
    console.log("Retrieving data from " + transactionsUrl);
    const transactions = await http.get(transactionsUrl);
    const distributableBalance = transactions.data.transactions.reduce((mem, val) => mem = mem + parseInt(val.amount), 0);
    const delegates = await Promise.all(config.requiredVotes.map(delegate => http.get(`/api/delegates/get?username=${delegate}`)));
    const delegateVoters = await Promise.all(delegates.map(async delegate => {
      const voters = await http.get(`/api/delegates/voters?publicKey=${delegate.data.delegate.publicKey}`);
      return {delegate: delegate.data.delegate.username, voters: voters.data.accounts};
    }));
    let eligableVoters = [];
    delegateVoters.forEach(delegate => {
      delegate.voters.forEach(voter => {
        const found = eligableVoters.filter(eligableVoter => eligableVoter.address == voter.address);
        if (found.length === 0) {
          eligableVoters.push({voter, votes: 1});
        } else {
          found[0].votes = found[0].votes + 1;
        }
      });
    });
    eligableVoters = eligableVoters.filter(eligableVoter => eligableVoter.votes == config.requiredVotes.length && delegates.filter(delegate => delegate.data.delegate.address == eligableVoter.voter.address).length === 0);
    const totalWeight = eligableVoters.reduce((mem, val) => mem = mem + parseInt(val.voter.balance), 0);
    eligableVoters.forEach(eligableVoter => {
      const eligibleBalance = math.floor(math.eval(`${distributableBalance} * (${parseInt(eligableVoter.voter.balance)} / ${totalWeight})`));
      const found = newBalance.accounts.filter(account => account.address == eligableVoter.voter.address);
      if (found.length === 0) {
        newBalance.accounts.push({address: eligableVoter.voter.address, paidBalance: 0, unpaidBalance: eligibleBalance})
      } else {
        found[0].unpaidBalance = found[0].unpaidBalance + parseInt(eligibleBalance);
      }
    });
    newBalance.updateTimestamp = newTimestamp;
    return newBalance;
  } catch(e) {
    console.log(e);
  }
}

async function app() {
  jsonfile.readFile(balanceFile, async (err, balance) => {
    if(!balance) {
      balance = {
        updateTimestamp: unixTimeStamp(new Date().getTime()),
        accounts: []
      }
    }
    try {
      const newBalance = await retrieveNewBalance(balance);
      console.log(`New owed balance: ${JSON.stringify(newBalance)}`);
      if (newBalance) {
        jsonfile.writeFile(balanceFile, newBalance, (err) => {
          if (err) {
            throw err;
          }
        });
      } else {
        throw new Error("Undefined balance");
      }
    } catch (e) {
      console.log('Encountered an error while trying to update the balance');
      throw e;
    }
  }); 
}

app();