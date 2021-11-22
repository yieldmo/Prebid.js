/* eslint-disable no-console */
// import { resolve } from 'core-js/fn/promise';
import { config } from '../src/config.js';
import { isGptPubadsDefined, isFn } from '../src/utils.js';
import strIncludes from 'core-js-pure/features/string/includes.js';

export const MODULE_NAME = 'Yieldmo Synthetic Inventory Module';
export const AD_SERVER_ENDPOINT = 'https://ads.yieldmo.com/v002/t_ads/ads';
export const AD_REQUEST_TYPE = 'GET';
const USPAPI_VERSION = 1;

let cmpVersion = 0;
let cmpResolved = false;

export function init(config) {
  validateConfig(config);

  const consentData = () => {
    const consentDataObj = {};
    return (api, result) => {
      consentDataObj[api] = result;
      // console.log('_________________' + api, result);
      if ('cmp' in consentDataObj && 'usp' in consentDataObj) {
        if (!isGptPubadsDefined()) {
          window.googletag = window.googletag || {};
          window.googletag.cmd = window.googletag.cmd || [];
        }
        getAd(`${AD_SERVER_ENDPOINT}?${serialize(collectData(config.placementId, consentDataObj))}`, config);
      }
    }
  };
  const consentDataHandler = consentData();
  lookupIabConsent((a) => consentDataHandler('cmp', a), (e) => consentDataHandler('cmp', false));
  lookupUspConsent((a) => consentDataHandler('usp', a), (e) => consentDataHandler('usp', false));
}

export function validateConfig(config) {
  if (!('placementId' in config)) {
    throw new Error(`${MODULE_NAME}: placementId required`);
  }
  if (!('adUnitPath' in config)) {
    throw new Error(`${MODULE_NAME}: adUnitPath required`);
  }
}

function googletagCmd(config, googletag) {
  const gamContainer = window.document.createElement('div');
  const containerName = 'ym_sim_container_' + config.placementId;
  gamContainer.id = containerName;
  window.document.body.appendChild(gamContainer);
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
  const pageDimensions = {
    density: window.devicePixelRatio || 0,
    height: window.screen.height || window.screen.availHeight || window.outerHeight || window.innerHeight || 481,
    width: window.screen.width || window.screen.availWidth || window.outerWidth || window.innerWidth || 321,
  };

  return {
    bust: timeStamp,
    dnt: window.doNotTrack === '1' || window.navigator.doNotTrack === '1' || false,
    pr: document.referrer || '',
    _s: 1,
    e: 4,
    page_url: window.top.location.href,
    p: placementId,
    description: description ? description.content.substring(0, 1000) : '',
    title: document.title,
    scrd: pageDimensions.density,
    h: pageDimensions.height,
    w: pageDimensions.width,
    pft: timeStamp,
    ct: timeStamp,
    connect: connection.effectiveType,
    bwe: connection.downlink ? connection.downlink + 'Mb/sec' : '',
    rtt: connection.rtt,
    sd: connection.saveData,
    us_privacy: (consentDataObj.usp && consentDataObj.usp.usPrivacy) || '',
    cmp: (consentDataObj.cmp && consentDataObj.cmp.tcString) || ''
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

function processResponse(response) {
  console.log('___res', response.status);
  let responseBody;
  try {
    responseBody = JSON.parse(response.responseText);
  } catch (err) {
    throw new Error(`${MODULE_NAME}: response body is not valid JSON`);
  }
  if (response.status !== 200 || !responseBody.data || !responseBody.data.length || !responseBody.data[0].ads || !responseBody.data[0].ads.length) {
    throw new Error(`${MODULE_NAME}: NOAD`);
  }
  return responseBody;
}

function getAd(url, config) {
  const req = new XMLHttpRequest();
  req.open(AD_REQUEST_TYPE, url, true);
  req.onload = (e) => {
    const response = processResponse(e.target);
    window.__ymAds = response;
    const googletag = window.googletag;
    googletag.cmd.push(() => {
      if (window.document.body) {
        googletagCmd(config, googletag);
      } else {
        window.document.addEventListener('DOMContentLoaded', () => googletagCmd(config, googletag));
      }
    });
  };
  req.send(null);
}

function lookupIabConsent(cmpSuccess, cmpError) {
  function findCMP() {
    let f = window;
    let cmpFrame;
    let cmpFunction;

    while (!cmpFrame) {
      try {
        if (isFn(f.__tcfapi)) {
          cmpVersion = 2;
          cmpFunction = f.__tcfapi;
          cmpFrame = f;
          break;
        }
      } catch (e) { }

      try {
        if (f.frames['__tcfapiLocator']) {
          cmpVersion = 2;
          cmpFrame = f;
          break;
        }
      } catch (e) { }

      if (f === window.top) break;
      f = f.parent;
    }
    return {
      cmpFrame,
      cmpFunction
    };
  }

  function cmpResponseCallback(tcfData, success) {
    console.log('Received a response from CMP', tcfData, success);
    if (success) {
      setTimeout(() => {
        if (!cmpResolved) {
          cmpSuccess(tcfData);
        }
      }, 3000);
      if (tcfData.gdprApplies === false || tcfData.eventStatus === 'tcloaded' || tcfData.eventStatus === 'useractioncomplete') {
        cmpSuccess(tcfData);
        cmpResolved = true;
      }
    } else {
      cmpError('CMP unable to register callback function.  Please check CMP setup.');
    }
  }

  let { cmpFrame, cmpFunction } = findCMP();

  if (!cmpFrame) {
    return cmpError('CMP not found.');
  }

  if (isFn(cmpFunction)) {
    console.log('Detected CMP API is directly accessible, calling it now...');
    cmpFunction('addEventListener', cmpVersion, cmpResponseCallback);
  } else {
    callCmpWhileInIframe('addEventListener', cmpFrame, cmpResponseCallback);
  }

  function callCmpWhileInIframe(commandName, cmpFrame, moduleCallback) {
    let apiName = '__tcfapi';
    let callName = `${apiName}Call`;
    let callId = Math.random() + '';
    let msg = {
      [callName]: {
        command: commandName,
        version: cmpVersion,
        parameter: undefined,
        callId: callId
      }
    };

    cmpFrame.postMessage(msg, '*');

    /** when we get the return message, call the stashed callback */
    window.addEventListener('message', readPostMessageResponse, false);

    function readPostMessageResponse(event) {
      let cmpDataPkgName = `${apiName}Return`;
      let json = (typeof event.data === 'string' && strIncludes(event.data, cmpDataPkgName)) ? JSON.parse(event.data) : event.data;
      if (json[cmpDataPkgName] && json[cmpDataPkgName].callId) {
        let payload = json[cmpDataPkgName];

        if (payload.callId === callId) {
          moduleCallback(payload.returnValue, payload.success);
        }
      }
    }
  }
}

function lookupUspConsent(uspSuccess, uspError) {
  function findUsp() {
    let f = window;
    let uspapiFrame;
    let uspapiFunction;

    while (!uspapiFrame) {
      try {
        if (isFn(f.__uspapi)) {
          uspapiFunction = f.__uspapi;
          uspapiFrame = f;
          break;
        }
      } catch (e) {}

      try {
        if (f.frames['__uspapiLocator']) {
          uspapiFrame = f;
          break;
        }
      } catch (e) {}
      if (f === window.top) break;
      f = f.parent;
    }
    return {
      uspapiFrame,
      uspapiFunction,
    };
  }

  function handleUspApiResponseCallbacks() {
    const uspResponse = {};

    function afterEach() {
      if (uspResponse.usPrivacy) {
        uspSuccess(uspResponse);
      } else {
        uspError('Unable to get USP consent string.');
      }
    }

    return {
      consentDataCallback: (consentResponse, success) => {
        if (success && consentResponse.uspString) {
          uspResponse.usPrivacy = consentResponse.uspString;
        }
        afterEach();
      },
    };
  }

  let callbackHandler = handleUspApiResponseCallbacks();
  let { uspapiFrame, uspapiFunction } = findUsp();

  if (!uspapiFrame) {
    return uspError('USP CMP not found.');
  }

  if (isFn(uspapiFunction)) {
    console.log('Detected USP CMP is directly accessible, calling it now...');
    uspapiFunction(
      'getUSPData',
      USPAPI_VERSION,
      callbackHandler.consentDataCallback
    );
  } else {
    console.log(
      'Detected USP CMP is outside the current iframe where Prebid.js is located, calling it now...'
    );
    callUspApiWhileInIframe(
      'getUSPData',
      uspapiFrame,
      callbackHandler.consentDataCallback
    );
  }

  function callUspApiWhileInIframe(commandName, uspapiFrame, moduleCallback) {
    let callId = Math.random() + '';
    let msg = {
      __uspapiCall: {
        command: commandName,
        version: USPAPI_VERSION,
        callId: callId,
      },
    };

    uspapiFrame.postMessage(msg, '*');

    /** when we get the return message, call the stashed callback */
    window.addEventListener('message', readPostMessageResponse, false);

    function readPostMessageResponse(event) {
      const res = event && event.data && event.data.__uspapiReturn;
      if (res && res.callId) {
        if (res.callId === callId) {
          moduleCallback(res.returnValue, res.success);
        }
      }
    }
  }
}

config.getConfig('yieldmo_synthetic_inventory', config => init(config.yieldmo_synthetic_inventory));
