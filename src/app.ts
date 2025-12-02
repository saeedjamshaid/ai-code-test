import * as paypal from '@paypal/checkout-server-sdk';

/**
 * Simple PayPal Orders API integration helpers.
 *
 * These functions are intentionally framework-agnostic so they can be used
 * from NestJS controllers, scripts, or tests without pulling in NestJS here.
 *
 * Environment variables expected:
 * - PAYPAL_CLIENT_ID
 * - PAYPAL_CLIENT_SECRET
 * - PAYPAL_MODE (optional: 'live' | 'sandbox', defaults to 'sandbox')
 */

function getEnvironment(): paypal.core.SandboxEnvironment | paypal.core.LiveEnvironment {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const mode = (process.env.PAYPAL_MODE || 'sandbox').toLowerCase();

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing PayPal credentials. Please set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET environment variables.',
    );
  }

  if (mode === 'live') {
    return new paypal.core.LiveEnvironment(clientId, clientSecret);
  }

  // Default to sandbox
  return new paypal.core.SandboxEnvironment(clientId, clientSecret);
}

let cachedClient: paypal.core.PayPalHttpClient | null = null;

function getClient(): paypal.core.PayPalHttpClient {
  if (!cachedClient) {
    cachedClient = new paypal.core.PayPalHttpClient(getEnvironment());
  }
  return cachedClient;
}

/**
 * Create a PayPal order.
 *
 * By default this creates a single purchase unit with a fixed amount,
 * but callers can override the request body if they need more control.
 */
export async function createOrder(
  bodyOverride?: Record<string, any>,
): Promise<{ id: string; raw: any }> {
  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer('return=representation');

  request.requestBody(
    bodyOverride ?? {
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: {
            currency_code: 'USD',
            value: '100.00',
          },
        },
      ],
    },
  );

  const client = getClient();
  const response = await client.execute(request);

  return {
    id: response.result.id,
    raw: response.result,
  };
}

/**
 * Retrieve an existing PayPal order by ID.
 */
export async function getOrder(orderId: string): Promise<any> {
  if (!orderId) {
    throw new Error('orderId is required to get a PayPal order.');
  }

  const request = new paypal.orders.OrdersGetRequest(orderId);
  const client = getClient();
  const response = await client.execute(request);

  return response.result;
}



