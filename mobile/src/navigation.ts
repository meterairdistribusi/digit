import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

export type RootStackParamList = {
  Tabs: undefined;
  Product: { id: number; name?: string };
  Order: { id: string };
  Legal: { name: string; title?: string };
  Login: undefined;
  Register: undefined;
};
export type Nav = NativeStackNavigationProp<RootStackParamList>;
