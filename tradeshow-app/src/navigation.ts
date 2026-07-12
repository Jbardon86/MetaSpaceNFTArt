import { NativeStackScreenProps } from '@react-navigation/native-stack';

// Navigation param list. The order flow builds a draft in AppContext, so the
// step screens don't need to pass the whole order through params.
export type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  OrderCustomer: undefined;
  OrderProducts: undefined;
  OrderProductDetail: { productId: string };
  OrderReview: undefined;
  OrderDetail: { orderId: string };
  Catalog: undefined;
};

export type ScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;
