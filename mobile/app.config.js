const appJson = require('./app.json');

module.exports = {
  expo: {
    ...appJson.expo,
    ios: {
      ...appJson.expo.ios,
      bundleIdentifier: process.env.EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER || appJson.expo.ios?.bundleIdentifier,
    },
    android: {
      ...appJson.expo.android,
      package: process.env.EXPO_PUBLIC_ANDROID_PACKAGE || appJson.expo.android?.package,
    },
    extra: {
      ...appJson.expo.extra,
      eas: {
        ...appJson.expo.extra?.eas,
        projectId: '97ee4776-149b-40aa-b7b9-f96989472fb1',
      },
    },
  },
};
