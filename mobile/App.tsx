import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { Text } from 'react-native';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/auth';
import type { RootStackParamList } from './src/navigation';
import AccountScreen from './src/screens/AccountScreen';
import { LoginScreen, RegisterScreen } from './src/screens/AuthScreens';
import HomeScreen from './src/screens/HomeScreen';
import LegalScreen from './src/screens/LegalScreen';
import OrderScreen from './src/screens/OrderScreen';
import OrdersScreen from './src/screens/OrdersScreen';
import ProductScreen from './src/screens/ProductScreen';
import { colors } from './src/theme';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();

const icon = (glyph: string) => ({ focused }: { focused: boolean }) => <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.55 }}>{glyph}</Text>;

function Tabs() {
  return (
    <Tab.Navigator screenOptions={{ tabBarActiveTintColor: colors.brand, headerShown: false }}>
      <Tab.Screen name="Beranda" component={HomeScreen} options={{ tabBarIcon: icon('🛍️') }} />
      <Tab.Screen name="Pesanan" component={OrdersScreen} options={{ tabBarIcon: icon('📦'), headerShown: true, title: 'Pesanan saya' }} />
      <Tab.Screen name="Akun" component={AccountScreen} options={{ tabBarIcon: icon('👤') }} />
    </Tab.Navigator>
  );
}

const navTheme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: colors.bg, primary: colors.brand } };

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer theme={navTheme}>
          <StatusBar style="dark" />
          <Stack.Navigator screenOptions={{ headerTintColor: colors.brand }}>
            <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
            <Stack.Screen name="Product" component={ProductScreen} options={({ route }) => ({ title: route.params.name ?? 'Produk' })} />
            <Stack.Screen name="Order" component={OrderScreen} options={{ title: 'Pesanan' }} />
            <Stack.Screen name="Legal" component={LegalScreen} options={({ route }) => ({ title: route.params.title ?? 'Dokumen' })} />
            <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'Masuk', presentation: 'modal' }} />
            <Stack.Screen name="Register" component={RegisterScreen} options={{ title: 'Daftar', presentation: 'modal' }} />
          </Stack.Navigator>
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
