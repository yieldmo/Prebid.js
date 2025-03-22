import { config } from '../src/config.js';
import { isGptPubadsDefined } from '../src/utils.js';
import * as ajax from '../src/ajax.js'
import { gdprDataHandler, uspDataHandler } from '../src/adapterManager.js';

const MODULE_NAME = 'yieldmoSyntheticInventory';
const AD_SERVER_ENDPOINT = 'https://ads.yieldmo.com/v002/t_ads/ads';
const GET_CONFIG_TIMEOUT = 10; // might be 0, 10 just in case

export const testExports = {
  MODULE_NAME,
  validateConfig,
  setGoogleTag,
  setAd,
  getConsentData,
  getConfigs,
  processAdResponse,
  getAd
};

function getConsentData() {
  return new Promise((resolve) => {
    Promise.allSettled([
      gdprDataHandler.promise,
      uspDataHandler.promise
    ])
      .then(([ cmp, usp ]) => {
        resolve({
          cmp: cmp.value,
          usp: usp.value
        });
      })
  });
}

function setGoogleTag() {
  if (!isGptPubadsDefined()) {
    window.top.googletag = window.top.googletag || {};
    window.top.googletag.cmd = window.top.googletag.cmd || [];
  }
}

function setAd(config, ad) {
  window.top.__ymAds = processAdResponse(ad);
  const googletag = window.top.googletag;
  googletag.cmd.push(() => {
    if (window.top.document.body) {
      googletagCmd(config, googletag);
    } else {
      window.top.document.addEventListener('DOMContentLoaded', () => googletagCmd(config, googletag));
    }
  });
}

function getAd(config, consentData) {
  const url = `${AD_SERVER_ENDPOINT}?${serialize(collectData(config.placementId, consentData))}`;
  return new Promise((resolve, reject) =>
    ajax.ajaxBuilder()(url, {
      success: (responseText, responseObj) => {
        resolve(responseObj);
      },
      error: (message, err) => {
        reject(new Error(`${MODULE_NAME}: ad server error: ${err.status}`));
      }
    }))
    .catch(err => {
      throw err;
    });
}

function validateConfig(config) {
  if (!('placementId' in config)) {
    throw new Error(`${MODULE_NAME}: placementId required`);
  }
  if (!('adUnitPath' in config)) {
    throw new Error(`${MODULE_NAME}: adUnitPath required`);
  }
}

function googletagCmd(config, googletag) {
  const gamContainer = window.top.document.createElement('div');
  const containerName = 'ym_sim_container_' + config.placementId;
  gamContainer.id = containerName;
  window.top.document.body.appendChild(gamContainer);
  googletag.defineSlot(config.adUnitPath, [1, 1], containerName)
    .addService(googletag.pubads())
    .setTargeting('ym_sim_p_id', config.placementId);
  googletag.enableServices();
  googletag.display(containerName);
}

function collectData(placementId, consentDataObj) {
  const timeStamp = new Date().getTime();
  const connection = window.navigator.connection || {};
  const description = Array.prototype.slice.call(document.getElementsByTagName('meta'))
    .filter((meta) => meta.getAttribute('name') === 'description')[0];

  return {
    bust: timeStamp,
    dnt: window.top.doNotTrack === '1' || window.top.navigator.doNotTrack === '1' || false,
    pr: document.referrer || '',
    _s: 1,
    e: 4,
    page_url: window.top.location.href,
    p: placementId,
    description: description ? description.content.substring(0, 1000) : '',
    title: document.title,
    scrd: window.top.devicePixelRatio || 0,
    h: window.top.screen.height || window.top.screen.availHeight || window.top.outerHeight || window.top.innerHeight || 481,
    w: window.top.screen.width || window.top.screen.availWidth || window.top.outerWidth || window.top.innerWidth || 321,
    pft: timeStamp,
    ct: timeStamp,
    connect: typeof connection.effectiveType !== 'undefined' ? connection.effectiveType : undefined,
    bwe: typeof connection.downlink !== 'undefined' ? connection.downlink + 'Mb/sec' : undefined,
    rtt: typeof connection.rtt !== 'undefined' ? String(connection.rtt) : undefined,
    sd: typeof connection.saveData !== 'undefined' ? String(connection.saveData) : undefined,
    us_privacy: consentDataObj.usp || '',
    cmp: (consentDataObj.cmp && consentDataObj.cmp.consentString) || ''
  };
}

function serialize(dataObj) {
  const str = [];
  for (let p in dataObj) {
    if (dataObj.hasOwnProperty(p) && (dataObj[p] || dataObj[p] === false)) {
      str.push(encodeURIComponent(p) + '=' + encodeURIComponent(dataObj[p]));
    }
  }
  return str.join('&');
}

function processAdResponse(res) {
  if (res.status >= 300) {
    throw new Error(`${MODULE_NAME}: ad server error: ${res.status}`);
    // 204 is a valid response, but we're throwing because it's always good to know
    // probably something has been wrong configured (placementId / adUnitPath / userConsent ...)
  } else if (res.status === 204) {
    throw new Error(`${MODULE_NAME}: ${res.status} - no ad to serve`);
  }
  let parsedResponseBody;
  try {
    parsedResponseBody = JSON.parse(res.responseText);
  } catch (err) {
    throw new Error(`${MODULE_NAME}: JSON validation error`);
  }
  if (parsedResponseBody.data && parsedResponseBody.data.length && parsedResponseBody.data[0].error_code) {
    throw new Error(`${MODULE_NAME}: no ad, error_code: ${parsedResponseBody.data[0].error_code}`);
  }
  return parsedResponseBody;
}

function checkSandbox(w) {
  try {
    return !w.top.document && w.top !== w && !w.frameElement;
  } catch (e) {
    throw new Error(`${MODULE_NAME}: module was placed in the sandbox iframe`);
  }
}
/**
 * Configs will be available only next JS event loop iteration after calling config.getConfig,
 * but... if user won't provide the configs, callback will never be executed
 * because of that we're using promises for the code readability (to prevent callback hell),
 * and setTimeout(__, 0) as a fallback in case configs wasn't provided...
*/
function getConfigs() {
  const promisifyGetConfig = configName =>
    new Promise((resolve) =>
      config.getConfig(configName, config => resolve(config)));

  const getConfigPromise = (moduleName) => {
    let timer;
    // Promise has a higher priority than callback, so it should be there first
    return Promise.race([
      promisifyGetConfig(moduleName),
      // will be rejected if config wasn't provided in GET_CONFIG_TIMEOUT ms
      new Promise((resolve, reject) => timer = setTimeout(reject,
        GET_CONFIG_TIMEOUT,
        new Error(`${MODULE_NAME}: ${moduleName} was not configured`)))
    ]).finally(() =>
      clearTimeout(timer));
  };
  // We're expecting to get both yieldmoSyntheticInventory
  // and consentManagement configs, so if one of them configs will be rejected --
  // getConfigs will be rejected as well
  return Promise.all([
    getConfigPromise('yieldmoSyntheticInventory'),
    getConfigPromise('consentManagement'),
  ])
}

getConfigs()
  .then(configs => {
    const siConfig = configs[0].yieldmoSyntheticInventory;
    validateConfig(siConfig);
    checkSandbox(window);
    setGoogleTag();
    getConsentData()
      .then(consentData =>
        getAd(siConfig, consentData))
      .then(ad =>
        setAd(siConfig, ad))
  })
