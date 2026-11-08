import { NativeStackScreenProps } from '@react-navigation/native-stack';

// Navigation param list. The order flow builds a draft in OrderDraft, so the
// step screens don't need to pass the whole order through params.
//
// Customer kiosk flow: Welcome → Details → OrderProducts → OrderReview → Confirmation.
// Staff area (PIN-gated from Welcome): Staff → StaffOrders / Catalog / OrderDetail.
export type RootStackParamList = {
  Welcome: undefined;
  Details: undefined;
  OrderProducts: undefined;
  OrderProductDetail: { productId: string };
  OrderReview: undefined;
  Confirmation: { orderId: string };
  Staff: undefined;
  StaffOrders: undefined;
  OrderDetail: { orderId: string };
  Catalog: undefined;
};

export type ScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;
