const store = require('./utils/store');

App({
  globalData: {},

  onLaunch() {
    store.load();
  },
});
