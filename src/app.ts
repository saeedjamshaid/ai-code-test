import * as https from 'https';
import { URLSearchParams } from 'url';

/**
 * Simple PayPal Orders API integration helpers implemented using HTTPS
 * directly, without any external SDK dependency.
 *
 * Environment variables expected:
 * - PAYPAL_CLIENT_ID
 * - PAYPAL_CLIENT_SECRET
 * - PAYPAL_MODE (optional: 'live' | 'sandbox', defaults to 'sandbox')
 */

function getPaypalHost(): string {
  const mode = (process.env.PAYPAL_MODE || 'sandbox').toLowerCase();
  return mode === 'live' ? 'api-m.paypal.com' : 'api-m.sandbox.paypal.com';
}

function getPaypalCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing PayPal credentials. Please set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET environment variables.',
    );
  }

  return { clientId, clientSecret };
}

function httpRequest<T = any>(options: https.RequestOptions, body?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          const parsed = raw ? JSON.parse(raw) : ({} as T);
          resolve(parsed as T);
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(body);
    }

    req.end();
  });
}

async function getAccessToken(): Promise<string> {
  const host = getPaypalHost();
  const { clientId, clientSecret } = getPaypalCredentials();

  const params = new URLSearchParams({ grant_type: 'client_credentials' });
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const options: https.RequestOptions = {
    hostname: host,
    path: '/v1/oauth2/token',
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(params.toString()),
    },
  };

  const response = await httpRequest<{ access_token: string }>(options, params.toString());
  if (!response.access_token) {
    throw new Error('Failed to obtain PayPal access token.');
  }

  return response.access_token;
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
  const host = getPaypalHost();
  const accessToken = await getAccessToken();

  const body =
    bodyOverride ??
    ({
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: {
            currency_code: 'USD',
            value: '100.00',
          },
        },
      ],
    } as Record<string, any>);

  const jsonBody = JSON.stringify(body);

  const options: https.RequestOptions = {
    hostname: host,
    path: '/v2/checkout/orders',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(jsonBody),
      'PayPal-Request-Id': `req-${Date.now()}`,
    },
  };

  const response = await httpRequest<any>(options, jsonBody);

  return {
    id: response.id,
    raw: response,
  };
}

/**
 * Retrieve an existing PayPal order by ID.
 */
export async function getOrder(orderId: string): Promise<any> {
  if (!orderId) {
    throw new Error('orderId is required to get a PayPal order.');
  }

  const host = getPaypalHost();
  const accessToken = await getAccessToken();

  const options: https.RequestOptions = {
    hostname: host,
    path: `/v2/checkout/orders/${encodeURIComponent(orderId)}`,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  };

  const response = await httpRequest<any>(options);
  return response;
}

