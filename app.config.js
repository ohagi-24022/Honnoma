const appJson = require('./app.json');

function clean(value) {
  return value && value.trim().replace(/^['"]|['"]$/g, '');
}

function cleanSupabaseUrl(value) {
  const cleaned = clean(value);
  return cleaned && cleaned.replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
}

module.exports = ({ config }) => ({
  ...config,
  ...appJson.expo,
  extra: {
    ...appJson.expo.extra,
    supabaseUrl: cleanSupabaseUrl(process.env.EXPO_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: clean(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
    googleBooksApiKey: clean(process.env.EXPO_PUBLIC_GOOGLE_BOOKS_API_KEY),
    rakutenAppId: clean(process.env.EXPO_PUBLIC_RAKUTEN_APP_ID),
    metadataOverrideApiUrl: clean(process.env.EXPO_PUBLIC_METADATA_OVERRIDE_API_URL),
  },
});

