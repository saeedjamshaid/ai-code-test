import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  Environment,
  LogLevel,
  OrdersController,
} from "@paypal/paypal-server-sdk";

let paypalClient: Client | null = null;

function getPayPalClient(): Client {
  if (!paypalClient) {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error(
        "Missing PayPal credentials. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET environment variables before calling PayPal APIs.",
      );
    }

    paypalClient = new Client({
      clientCredentialsAuthCredentials: {
        oAuthClientId: clientId,
        oAuthClientSecret: clientSecret,
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
  }

  return paypalClient;
}

export async function createOrder() {
  const client = getPayPalClient();
  const ordersController = new OrdersController(client);

  const orderRequest = {
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [
        {
          amount: {
            currencyCode: "USD",
            value: "100.00",
          },
        },
      ],
    },
    prefer: "return=minimal" as const,
  };

  try {
    const response = await ordersController.createOrder(orderRequest);
    return response.result;
  } catch (error) {
    if (error instanceof ApiError) {
      // Keep logging minimal; callers can decide how to surface errors.
      // eslint-disable-next-line no-console
      console.error("PayPal API Error (createOrder):", error);
    }
    throw error;
  }
}

export async function getOrder(orderId: string) {
  if (!orderId) {
    throw new Error("orderId is required to retrieve an order.");
  }

  const client = getPayPalClient();
  const ordersController = new OrdersController(client);

  try {
    const response = await ordersController.getOrder({ id: orderId });
    return response.result;
  } catch (error) {
    if (error instanceof ApiError) {
      // eslint-disable-next-line no-console
      console.error("PayPal API Error (getOrder):", error);
    }
    throw error;
  }
}


