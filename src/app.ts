import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  Environment,
  LogLevel,
  OrdersController,
} from '@paypal/paypal-server-sdk';

const client = new Client({
  clientCredentialsAuthCredentials: {
    oAuthClientId: 'OAuthClientId',
    oAuthClientSecret: 'OAuthClientSecret'
  },
  timeout: 0,
  environment: Environment.Sandbox,
  logging: {
    logLevel: LogLevel.Info,
    logRequest: {
      logBody: true
    },
    logResponse: {
      logHeaders: true
    }
  },
});

const ordersController = new OrdersController(client);

async function createAndCaptureOrder() {
  const createOrderRequest = {
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [
        {
          amount: {
            currencyCode: 'EUR',
            value: '100.00',
          },
        }
      ],
      paymentSource: {
        mybank: {
          name: 'John Doe',
          countryCode: 'IT'
        }
      }
    },
    prefer: 'return=minimal'
  };

  try {
    const createOrderResponse = await ordersController.createOrder(createOrderRequest);
    const orderId = createOrderResponse.result.id;

    console.log('Order created with ID:', orderId);

    const captureOrderRequest = {
      id: orderId as string,
      prefer: 'return=minimal'
    };

    const captureOrderResponse = await ordersController.captureOrder(captureOrderRequest);

    console.log('Order captured with ID:', captureOrderResponse.result.id);
    console.log('Capture status:', captureOrderResponse.result.status);

  } catch (error) {
    if (error instanceof ApiError) {
      console.error('API Error:', error.statusCode, error.body);
    } else {
      console.error('Unexpected Error:', error);
    }
  }
}

createAndCaptureOrder();