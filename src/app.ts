import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  Environment,
  LogLevel,
  OrdersController,
} from '@paypal/paypal-server-sdk';

// Shared PayPal API client instance
const paypalClient = new Client({
  clientCredentialsAuthCredentials: {
    oAuthClientId: process.env.PAYPAL_CLIENT_ID ?? '',
    oAuthClientSecret: process.env.PAYPAL_CLIENT_SECRET ?? '',
  },
  timeout: 0,
  environment: Environment.Sandbox,
  logging: {
    logLevel: LogLevel.Info,
    logRequest: {
      logBody: true,
    },
    logResponse: {
      logHeaders: true,
    },
  },
});

const ordersController = new OrdersController(paypalClient);

export interface CreateOrderParams {
  currencyCode: string;
  value: string;
}

export interface CreatedOrder {
  id: string;
  status?: string;
  links?: unknown;
}

export interface RetrievedOrder {
  id: string;
  status?: string;
  purchaseUnits?: unknown;
}

export async function createOrder(params?: CreateOrderParams): Promise<CreatedOrder> {
  const collect = {
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [
        {
          amount: {
            currencyCode: params?.currencyCode ?? 'USD',
            value: params?.value ?? '100.00',
          },
        },
      ],
    },
    prefer: 'return=minimal',
  };

  try {
    const response = await ordersController.createOrder(collect);

    if (!response.result || !response.result.id) {
      throw new Error('Failed to create PayPal order: Missing order ID in response');
    }

    return {
      id: response.result.id,
      status: response.result.status,
      links: response.result.links,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      // eslint-disable-next-line no-console
      console.error('PayPal Create Order API Error:', error.statusCode, error.body);
    }
    throw error;
  }
}

export async function getOrder(orderId: string): Promise<RetrievedOrder> {
  const collect = {
    id: orderId,
  };

  try {
    const response = await ordersController.getOrder(collect);

    if (!response.result || !response.result.id) {
      throw new Error('Failed to fetch PayPal order: Missing order ID in response');
    }

    return {
      id: response.result.id,
      status: response.result.status,
      purchaseUnits: response.result.purchaseUnits,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      // eslint-disable-next-line no-console
      console.error('PayPal Get Order API Error:', error.statusCode, error.body);
    }
    throw error;
  }
}


