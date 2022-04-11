import { expect } from 'chai';
import * as ajax from 'src/ajax.js';
import { testExports } from 'modules/yieldmoSyntheticInventoryModule';
import { config } from 'src/config.js';

const mockedYmConfig = {
  placementId: '123456',
  adUnitPath: '/6355419/ad_unit_name_used_in_gam'
};

const setGoogletag = () => {
  window.top.googletag = {
    cmd: [],
    defineSlot: sinon.stub(),
    addService: sinon.stub(),
    pubads: sinon.stub(),
    setTargeting: sinon.stub(),
    enableServices: sinon.stub(),
    display: sinon.stub(),
  };
  window.top.googletag.defineSlot.returns(window.top.googletag);
  window.top.googletag.addService.returns(window.top.googletag);
  window.top.googletag.pubads.returns({getSlots: sinon.stub()});
  return window.top.googletag;
}

const getQuearyParamsFromUrl = (url) =>
  [...new URL(url).searchParams]
    .reduce(
      (agg, param) => {
        const [key, value] = param;

        agg[key] = value;

        return agg;
      },
      {}
    );

describe('Yieldmo Synthetic Inventory Module', function() {
  let googletagBkp;
  let sandbox;

  beforeEach(function () {
    googletagBkp = window.googletag;
    delete window.googletag;
    sandbox = sinon.sandbox.create();
  });

  afterEach(function () {
    window.googletag = googletagBkp;
    sandbox.restore();
  });

  describe('Module config initialization', () => {
    it('getConfigs should call config.getConfig twice to get yieldmoSyntheticInventory and consentManagement configs', function() {
      const getConfigStub = sandbox.stub(config, 'getConfig').returns({});

      return testExports.getConfigs()
        .catch(() => {
          expect(getConfigStub.calledWith('yieldmoSyntheticInventory')).to.equal(true);
          expect(getConfigStub.calledWith('consentManagement')).to.equal(true);
        });
    });

    it('should throw an error if config.placementId is missing', function() {
      const { placementId, ...rest } = mockedYmConfig;

      expect(function () {
        testExports.validateConfig(rest);
      }).throw(`${testExports.MODULE_NAME}: placementId required`);
    });

    it('should throw an error if config.adUnitPath is missing', function() {
      const { adUnitPath, ...rest } = mockedYmConfig;

      expect(function () {
        testExports.validateConfig(rest);
      }).throw(`${testExports.MODULE_NAME}: adUnitPath required`);
    });
  });

  describe('getConsentData', () => {
    it('should always resolves with object contained "cmp" and "usp" keys', () => {
      const consentDataMock = {
        cmp: null,
        usp: null
      };

      return testExports.getConsentData()
        .then(consentDataObj =>
          expect(consentDataObj).to.eql(consentDataMock));
    });
  });

  describe('Get ad', () => {
    let sandbox;

    const setAjaxStub = (cb) => {
      const ajaxStub = sandbox.stub().callsFake(cb);
      sandbox.stub(ajax, 'ajaxBuilder').callsFake(() => ajaxStub);
      return ajaxStub;
    };
    const responseData = {
      data: [{
        ads: [{
          foo: 'bar',
        }]
      }]
    };

    beforeEach(() => {
      sandbox = sinon.sandbox.create();
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should make ad request to ad server', () => {
      const ajaxStub = setAjaxStub((url, callbackObj) => {
        callbackObj.success('', {responseText: '', status: 200});
      });

      return testExports.getAd(mockedYmConfig, {cmp: null, usp: null})
        .then(res => { expect(ajaxStub.calledOnce).to.be.true });
    });

    it('should throw an error if server returns an error', () => {
      const response = {status: 500};
      const ajaxStub = setAjaxStub((url, callbackObj) => {
        callbackObj.error('', { status: 500 });
      });

      return testExports.getAd(mockedYmConfig, {cmp: null, usp: null})
        .catch(err => {
          expect(err.message).to.be.equal(`${testExports.MODULE_NAME}: ad server error: ${response.status}`)
        });
    });

    it('should properly create ad request url', () => {
      const title = 'Test title value';
      const ajaxStub = setAjaxStub((url, callbackObj) => {
        callbackObj.success('', {responseText: '', status: 200});
      });
      const documentStubTitle = sandbox.stub(document, 'title').value(title);
      const connection = window.navigator.connection || {};

      return testExports.getAd(mockedYmConfig, {cmp: null, usp: null})
        .then(res => {
          const queryParams = getQuearyParamsFromUrl(ajaxStub.getCall(0).args[0]);
          const timeStamp = queryParams.bust;

          const paramsToCompare = {
            title,
            _s: '1',
            dnt: 'false',
            e: '4',
            p: mockedYmConfig.placementId,
            page_url: window.top.location.href,
            pr: window.top.location.href,
            bust: timeStamp,
            pft: timeStamp,
            ct: timeStamp,
            connect: typeof connection.effectiveType !== 'undefined' ? connection.effectiveType : undefined,
            bwe: typeof connection.downlink !== 'undefined' ? connection.downlink + 'Mb/sec' : undefined,
            rtt: typeof connection.rtt !== 'undefined' ? String(connection.rtt) : undefined,
            sd: typeof connection.saveData !== 'undefined' ? String(connection.saveData) : undefined,
            scrd: String(window.top.devicePixelRatio || 0),
            h: String(window.top.screen.height || window.screen.top.availHeight || window.top.outerHeight || window.top.innerHeight || 481),
            w: String(window.top.screen.width || window.screen.top.availWidth || window.top.outerWidth || window.top.innerWidth || 321),
          };

          expect(queryParams).to.eql(JSON.parse(JSON.stringify(paramsToCompare)));
        })
        .catch(err => { throw err; });
    });
  });

  describe('setAd', () => {
    let sandbox;

    const setAjaxStub = (cb) => {
      const ajaxStub = sandbox.stub().callsFake(cb);
      sandbox.stub(ajax, 'ajaxBuilder').callsFake(() => ajaxStub);
      return ajaxStub;
    }

    beforeEach(() => {
      sandbox = sinon.sandbox.create();
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should set window.top.googletag and window.top.googletag.cmd', () => {
      expect(window.top.googletag).to.be.undefined;

      testExports.setGoogleTag();

      expect(window.top.googletag).to.be.eql({cmd: []});
    });

    it('should add correct googletag.cmd', function() {
      const containerName = 'ym_sim_container_' + mockedYmConfig.placementId;
      const gtag = setGoogletag();

      const ajaxStub = setAjaxStub((url, callbackObj) => {
        callbackObj.success(JSON.stringify(responseData), {status: 200, responseText: '{"data": [{"ads": []}]}'});
      });

      testExports.setAd(mockedYmConfig, {
        responseText: `{
          "data": []
        }`
      });

      expect(gtag.cmd.length).to.equal(1);

      gtag.cmd[0]();

      expect(gtag.addService.getCall(0)).to.not.be.null;
      expect(gtag.setTargeting.getCall(0)).to.not.be.null;
      expect(gtag.setTargeting.getCall(0).args[0]).to.exist.and.to.equal('ym_sim_p_id');
      expect(gtag.setTargeting.getCall(0).args[1]).to.exist.and.to.equal(mockedYmConfig.placementId);
      expect(gtag.defineSlot.getCall(0)).to.not.be.null;
      expect(gtag.enableServices.getCall(0)).to.not.be.null;
      expect(gtag.display.getCall(0)).to.not.be.null;
      expect(gtag.display.getCall(0).args[0]).to.exist.and.to.equal(containerName);
      expect(gtag.pubads.getCall(0)).to.not.be.null;

      const gamContainerEl = window.top.document.getElementById(containerName);
      expect(gamContainerEl).to.not.be.null;

      gamContainerEl.parentNode.removeChild(gamContainerEl);
    });
  });

  describe('processAdResponse', () => {
    it('should throw if ad response has 204 code', () => {
      const response = { status: 204 }

      expect(() => testExports.processAdResponse(response))
        .to.throw(`${testExports.MODULE_NAME}: ${response.status} - no ad to serve`)
    });

    it('should throw if ad response has 204 code', () => {
      const response = { status: 200, responseText: '__invalid_json__' }

      expect(() => testExports.processAdResponse(response))
        .to.throw(`${testExports.MODULE_NAME}: JSON validation error`)
    });

    it('should throw if ad response has error_code', () => {
      const response = {
        responseText: `{
          "data": [
            {
              "error_code": "NOAD"
            }
          ]
        }`
      };

      expect(() => testExports.processAdResponse(response))
        .to.throw(`${testExports.MODULE_NAME}: no ad, error_code: ${JSON.parse(response.responseText).data[0].error_code}`)
    });
  });
});
