import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppProvider, useApp } from './src/store/AppContext';
import { OrderDraftProvider } from './src/store/OrderDraft';
import { RootStackParamList } from './src/navigation';
import { colors } from './src/theme';

import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import OrderCustomerScreen from './src/screens/OrderCustomerScreen';
import OrderProductsScreen from './src/screens/OrderProductsScreen';
import OrderReviewScreen from './src/screens/OrderReviewScreen';
import OrderDetailScreen from './src/screens/OrderDetailScreen';
import CatalogScreen from './src/screens/CatalogScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

function Root() {
  const { loading, session } = useApp();

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
        screenOptions={{
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        {!session ? (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Orders' }} />
            <Stack.Screen
              name="OrderCustomer"
              component={OrderCustomerScreen}
              options={{ title: 'Customer' }}
            />
            <Stack.Screen
              name="OrderProducts"
              component={OrderProductsScreen}
              options={{ title: 'Products' }}
            />
            <Stack.Screen
              name="OrderReview"
              component={OrderReviewScreen}
              options={{ title: 'Review Order' }}
            />
            <Stack.Screen
              name="OrderDetail"
              component={OrderDetailScreen}
              options={{ title: 'Order' }}
            />
            <Stack.Screen name="Catalog" component={CatalogScreen} options={{ title: 'Catalog' }} />
          </>
        )}
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
