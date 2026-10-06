const appJson = require('./app.json');

function clean(value) {
  return value && value.trim().replace(/^['"]|['"]$/g, '');
}

function cleanSupabaseUrl(value) {
  const cleaned = clean(value);
  return cleaned && cleaned.replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
}

// Remote builds must not produce an app with sign-in silently disabled.
if (process.env.EAS_BUILD === 'true') {
  const missing = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'].filter(
    (name) => !clean(process.env[name]),
  );
  if (missing.length > 0) {
    throw new Error(`EAS環境にログイン用の接続設定がありません: ${missing.join(', ')}`);
  }
}

module.exports = ({ config }) => ({
  ...config,
  ...appJson.expo,
  name: process.env.APP_ENV === 'preview' ? `${appJson.expo.name} Preview` : appJson.expo.name,
  ios: {
    ...appJson.expo.ios,
    bundleIdentifier:
      process.env.APP_ENV === 'preview'
        ? `${appJson.expo.ios.bundleIdentifier}.preview`
        : appJson.expo.ios.bundleIdentifier,
  },
  extra: {
    ...appJson.expo.extra,
    supabaseUrl: cleanSupabaseUrl(process.env.EXPO_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: clean(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
    googleBooksApiKey: clean(process.env.EXPO_PUBLIC_GOOGLE_BOOKS_API_KEY),
    rakutenAppId: clean(process.env.EXPO_PUBLIC_RAKUTEN_APP_ID),
    metadataOverrideApiUrl: clean(process.env.EXPO_PUBLIC_METADATA_OVERRIDE_API_URL),
  },
});

