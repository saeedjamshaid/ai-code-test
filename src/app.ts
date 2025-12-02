import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  Environment,
  LogLevel,
  OrdersController,
} from '@paypal/paypal-server-sdk';

/**
 * PayPal API client configured using environment variables:
 * PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.
 */
const paypalClient = new Client({
  clientCredentialsAuthCredentials: {
    oAuthClientId: process.env.PAYPAL_CLIENT_ID ?? '',
    oAuthClientSecret: process.env.PAYPAL_CLIENT_SECRET ?? '',
  },
  environment: Environment.Sandbox,
  timeout: 0,
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

export interface CreateOrderResult {
  id: string;
  status: string;
}

/**
 * Creates a PayPal order with a single hard-coded purchase unit of 10.00 USD.
 * Returns the created order's ID and status.
 */
export async function createOrder(): Promise<CreateOrderResult> {
  const request = {
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [
        {
          amount: {
            currencyCode: 'USD',
            value: '10.00',
          },
        },
      ],
    },
    prefer: 'return=representation',
  };

  try {
    const response = await ordersController.createOrder(request);
    const result = response.result;

    if (!result || !result.id || !result.status) {
      throw new Error('PayPal create order response did not include id or status.');
    }

    return {
      id: result.id,
      status: result.status,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      // Log additional diagnostics while preserving the original error.
      console.error('PayPal API Error (createOrder):', {
        statusCode: error.statusCode,
        body: error.body,
      });
    }

    throw error;
  }
}

export interface GetOrderResult {
  id: string;
  status: string;
}

/**
 * Retrieves a PayPal order by ID.
 * Returns the order's ID and status.
 */
export async function getOrder(orderId: string): Promise<GetOrderResult> {
  const request = {
    id: orderId,
  };

  try {
    const response = await ordersController.getOrder(request);
    const result = response.result;

    if (!result || !result.id || !result.status) {
      throw new Error('PayPal get order response did not include id or status.');
    }

    return {
      id: result.id,
      status: result.status,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      console.error('PayPal API Error (getOrder):', {
        statusCode: error.statusCode,
        body: error.body,
      });
    }

    throw error;
  }
}

