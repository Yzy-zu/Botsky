'use strict';
const {execSync} = require('child_process');
const {sendText} = require('../services/evolution');
const { TIMEOUT } = require('dns');

async function cambiarTele(from, telesita) {
    try {
        await sendText(from, 'Cambiando de canal...');
    }catch (_){

    }
    try {
        execSync(`cd ~/tv && bash cambiarcanal.sh ${telesita}`,{ stdio: 'ignore'});
    }catch (err){

    }
    
    
}
module.exports = {cambiarTele}