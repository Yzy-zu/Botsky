// @ts-check
'use strict';
/** @param {{clock:{now:()=>number},threshold?:number,cooldownMs?:number,maxConcurrent?:number}} options */
function createCircuitBreaker({clock,threshold=3,cooldownMs=60000,maxConcurrent=4}) {
    if(!Number.isInteger(threshold)||threshold<1||!Number.isInteger(maxConcurrent)||maxConcurrent<1||!Number.isFinite(cooldownMs)||cooldownMs<=0)throw new TypeError('Invalid breaker options');
    let failures=0,until=0,active=0,epoch=0;let probe=false;
    function available(){return clock.now()>=until&&!probe&&active<maxConcurrent;}
    /** @returns {{success:()=>void,failure:(trip?:boolean)=>void}|null} */
    function acquire(){if(!available())return null;const half=failures>=threshold; if(half)probe=true;active++;let settled=false;const generation=epoch;
        /** @param {boolean} success @param {boolean} [trip] */function settle(success,trip=false){if(settled)return;settled=true;active--;if(generation!==epoch)return;if(half)probe=false;
            if(success){if(until>clock.now())return;failures=0;until=0;}else{failures++;if(trip||half||failures>=threshold){until=clock.now()+cooldownMs;failures=Math.max(failures,threshold);epoch++;probe=false;}}}
        return{success:()=>settle(true),failure:(trip=false)=>settle(false,trip)};
    }
    function reset(){epoch++;failures=0;until=0;probe=false;}
    function trip(){epoch++;failures=threshold;until=clock.now()+cooldownMs;probe=false;}
    return{acquire,available,trip,reset,snapshot:()=>({failures,until,active,halfOpen:probe})};
}
module.exports={createCircuitBreaker};
