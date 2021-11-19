import { expect } from 'chai';
import {
  init,
  MODULE_NAME,
  validateConfig
} from 'modules/yieldmoSyntheticInventoryModule';

const mockedYmConfig = {
  placementId: '123456',
  adUnitPath: '/6355419/ad_unit_name_used_in_gam'
};

const setGoogletag = () => {
  window.googletag = {
    cmd: [],
    defineSlot: sinon.stub(),
    addService: sinon.stub(),
    pubads: sinon.stub(),
    setTargeting: sinon.stub(),
    enableServices: sinon.stub(),
    display: sinon.stub(),
  };
  window.googletag.defineSlot.returns(window.googletag);
  window.googletag.addService.returns(window.googletag);
  window.googletag.pubads.returns({getSlots: sinon.stub()});
  return window.googletag;
}

describe('Yieldmo Synthetic Inventory Module', function() {
  let config = Object.assign({}, mockedYmConfig);
  let googletagBkp;

  beforeEach(function () {
    googletagBkp = window.googletag;
    delete window.googletag;
  });

  afterEach(function () {
    window.googletag = googletagBkp;
  });

  it('should be enabled with valid required params', function() {
    expect(function () {
      init(mockedYmConfig);
    }).not.to.throw()
  });

  it('should throw an error if placementId is missed', function() {
    const {placementId, ...config} = mockedYmConfig;

    expect(function () {
      validateConfig(config);
    }).throw(`${MODULE_NAME}: placementId required`)
  });

  it('should throw an error if adUnitPath is missed', function() {
    const {adUnitPath, ...config} = mockedYmConfig;

    expect(function () {
      validateConfig(config);
    }).throw(`${MODULE_NAME}: adUnitPath required`)
  });

  describe('getAd', () => {
    let requestMock = {
      open: sinon.stub(),
      send: sinon.stub(),
    };
    const originalXMLHttpRequest = window.XMLHttpRequest;
    const originalConnection = window.navigator.connection;
    let clock;
    let adServerRequest;
    let response;
    const responseData = {
      data: [{
        ads: [{
          foo: 'bar',
        }]
      }]
    };

    before(() => {
      window.XMLHttpRequest = function FakeXMLHttpRequest() {
        this.open = requestMock.open;
        this.send = requestMock.send;

        adServerRequest = this;
      };

      clock = sinon.useFakeTimers();
      clock.reset();
      Object.defineProperty(window.navigator, 'connection', { value: {}, writable: true });
    });

    beforeEach(() => {
      response = {
        target: {
          responseText: JSON.stringify(responseData),
          status: 200,
        }
      };
    });

    afterEach(() => {
      requestMock.open.resetBehavior();
      requestMock.open.resetHistory();
      requestMock.send.resetBehavior();
      requestMock.send.resetHistory();

      adServerRequest = undefined;

      clock.restore();
    });

    after(() => {
      window.XMLHttpRequest = originalXMLHttpRequest;
      window.navigator.connection = originalConnection;
    })

    it('should open ad request to ad server', () => {
      init(mockedYmConfig);

      const adServerHost = (new URL(requestMock.open.getCall(0).args[1])).host;
      expect(adServerHost).to.be.equal('ads.yieldmo.com');
    });

    it('should properly combine ad request query', () => {
      const pageDimensions = {
        density: window.devicePixelRatio || 0,
        height: window.screen.height || window.screen.availHeight || window.outerHeight || window.innerHeight || 481,
        width: window.screen.width || window.screen.availWidth || window.outerWidth || window.innerWidth || 321,
      };

      init(mockedYmConfig);

      const queryParams = [...(new URL(requestMock.open.getCall(0).args[1])).searchParams]
        .reduce(
          (agg, param) => {
            const [key, value] = param;

            agg[key] = value;

            return agg;
          },
          {}
        );

      const timeStamp = queryParams.bust;

      expect(queryParams).to.deep.equal({
        _s: '1',
        bust: timeStamp,
        ct: timeStamp,
        dnt: 'false',
        e: '4',
        h: `${pageDimensions.height}`,
        p: mockedYmConfig.placementId,
        page_url: window.top.location.href,
        pft: timeStamp,
        pr: window.top.location.href,
        scrd: `${pageDimensions.density}`,
        w: `${pageDimensions.width}`,
      });
    });

    it('should send ad request to ad server', () => {
      init(mockedYmConfig);

      expect(requestMock.send.calledOnceWith(null)).to.be.true;
    });

    it('should throw an error if can not parse response', () => {
      response.target.responseText = undefined;

      init(mockedYmConfig);

      expect(() => adServerRequest.onload(response)).to.throw();
    });

    it('should throw an error if status is not 200', () => {
      response.target.status = 500;

      init(mockedYmConfig);

      expect(() => adServerRequest.onload(response)).to.throw();
    });

    it('should throw an error if there is no data in response', () => {
      response.target.responseText = '{}';

      init(mockedYmConfig);

      expect(() => adServerRequest.onload(response)).to.throw();
    });

    it('should throw an error if there is no ads in response data', () => {
      response.target.responseText = '{ data: [{}] }';

      init(mockedYmConfig);

      expect(() => adServerRequest.onload(response)).to.throw();
    });

    it('should store ad response in window object', () => {
      init(mockedYmConfig);

      adServerRequest.onload(response)

      expect(window.__ymAds).to.deep.equal(responseData);
    });

    it('should add correct googletag.cmd', function() {
      const containerName = 'ym_sim_container_' + mockedYmConfig.placementId;
      const gtag = setGoogletag();

      init(mockedYmConfig);

      adServerRequest.onload(response)

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

      const gamContainerEl = window.document.getElementById(containerName);
      expect(gamContainerEl).to.not.be.null;

      gamContainerEl.parentNode.removeChild(gamContainerEl);
    });
  });

  describe('lookupIabConsent', () => {
    const cmpFunction = sinon.stub();

    afterEach(() => {
      cmpFunction.resetBehavior();
      cmpFunction.resetHistory();
    });

    it('should get cmp function from __tcfapi', () => {
      window.__tcfapi = cmpFunction;

      init(mockedYmConfig);

      window.__tcfapi = undefined;

      expect(cmpFunction.calledOnceWith('addEventListener', 2)).to.be.true;
    });

    it('should get cmp function from __cmp', () => {
      window.__cmp = cmpFunction;

      init(mockedYmConfig);

      window.__cmp = undefined;

      expect(cmpFunction.callCount).to.be.equal(2);
      expect(cmpFunction.calledWith('getConsentData', null)).to.be.true;
      expect(cmpFunction.calledWith('getVendorConsents', null)).to.be.true;
    });

    it('should get cmp function from __cmp', () => {
      const getConsentDataStub = sinon.stub();
      const getVendorConsentsStub = sinon.stub();

      cmpFunction.callsFake((event, version, callback) => {
        if (event === 'getConsentData') {
          callback(getConsentDataStub)
        } else {
          callback(getVendorConsentsStub)
        }
      });

      window.__cmp = cmpFunction;

      init(mockedYmConfig);

      window.__cmp = undefined;

      expect(cmpFunction.callCount).to.be.equal(2);
      expect(cmpFunction.calledWith('getConsentData', null)).to.be.true;
      expect(cmpFunction.calledWith('getVendorConsents', null)).to.be.true;
    });
  });
});
