import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppProvider, useApp } from './src/store/AppContext';
import { OrderDraftProvider } from './src/store/OrderDraft';
import { RootStackParamList } from './src/navigation';
import { colors } from './src/theme';

import WelcomeScreen from './src/screens/WelcomeScreen';
import DetailsScreen from './src/screens/DetailsScreen';
import OrderProductsScreen from './src/screens/OrderProductsScreen';
import OrderProductDetailScreen from './src/screens/OrderProductDetailScreen';
import OrderReviewScreen from './src/screens/OrderReviewScreen';
import ConfirmationScreen from './src/screens/ConfirmationScreen';
import StaffScreen from './src/screens/StaffScreen';
import StaffOrdersScreen from './src/screens/StaffOrdersScreen';
import OrderDetailScreen from './src/screens/OrderDetailScreen';
import CatalogScreen from './src/screens/CatalogScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

function Root() {
  const { loading } = useApp();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Welcome"
        screenOptions={{
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Details" component={DetailsScreen} options={{ title: 'Your Details' }} />
        <Stack.Screen name="OrderProducts" component={OrderProductsScreen} options={{ title: 'Products' }} />
        <Stack.Screen name="OrderProductDetail" component={OrderProductDetailScreen} options={{ title: '' }} />
        <Stack.Screen name="OrderReview" component={OrderReviewScreen} options={{ title: 'Your Order' }} />
        <Stack.Screen
          name="Confirmation"
          component={ConfirmationScreen}
          options={{ headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen name="Staff" component={StaffScreen} options={{ headerShown: false }} />
        <Stack.Screen name="StaffOrders" component={StaffOrdersScreen} options={{ title: 'Orders' }} />
        <Stack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: 'Order' }} />
        <Stack.Screen name="Catalog" component={CatalogScreen} options={{ title: 'Catalog' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <OrderDraftProvider>
          <Root />
          <StatusBar style="light" />
        </OrderDraftProvider>
      </AppProvider>
    </SafeAreaProvider>
  );
}
