import AsyncStorage from '@react-native-async-storage/async-storage';

export async function getStorageItemWithLegacy(key: string, legacyKey?: string) {
  const currentValue = await AsyncStorage.getItem(key);
  if (currentValue !== null || !legacyKey || legacyKey === key) return currentValue;

  const legacyValue = await AsyncStorage.getItem(legacyKey);
  if (legacyValue !== null) {
    await AsyncStorage.setItem(key, legacyValue);
  }
  return legacyValue;
}

export async function removeStorageItemWithLegacy(key: string, legacyKey?: string) {
  await AsyncStorage.removeItem(key);
  if (legacyKey && legacyKey !== key) {
    await AsyncStorage.removeItem(legacyKey);
  }
}