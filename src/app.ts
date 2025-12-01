import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  CustomError,
  Environment,
  LogLevel,
  OrdersController
} from "@paypal/paypal-server-sdk";

type CreateOrderOptions = {
  amount?: string;
  currencyCode?: string;
  intent?: CheckoutPaymentIntent;
  referenceId?: string;
  preferMinimalResponse?: boolean;
};

let cachedOrdersController: OrdersController | null = null;

function resolveEnvironment(rawValue: string | undefined | null): Environment {
  const normalized = (rawValue ?? "sandbox").trim().toLowerCase();
  if (normalized === "production" || normalized === "live") {
    return Environment.Production;
  }
  return Environment.Sandbox;
}

function parseTimeout(rawTimeout: string | undefined | null): number {
  const parsed = Number.parseInt(rawTimeout ?? "0", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function resolveConfig() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing PayPal credentials. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET environment variables before calling PayPal APIs."
    );
  }

  return {
    clientId,
    clientSecret,
    environment: resolveEnvironment(process.env.PAYPAL_ENV),
    timeout: parseTimeout(process.env.PAYPAL_TIMEOUT_MS)
  };
}

function getOrdersController(): OrdersController {
  if (cachedOrdersController) {
    return cachedOrdersController;
  }

  const { clientId, clientSecret, environment, timeout } = resolveConfig();

  const client = new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: clientId,
      oAuthClientSecret: clientSecret
    },
    environment,
    timeout,
    logging: {
      logLevel: LogLevel.Info,
      logRequest: { logBody: true },
      logResponse: { logHeaders: true }
    }
  });

  cachedOrdersController = new OrdersController(client);
  return cachedOrdersController;
}

function handlePayPalError(context: string, error: unknown): never {
  if (error instanceof ApiError) {
    console.error(`${context} (status: ${error.statusCode})`);
    if (error.body) {
      console.error("Response body:", JSON.stringify(error.body, null, 2));
    }

    if (error instanceof CustomError && error.result) {
      console.error("Error name:", error.result.name);
      console.error("Error message:", error.result.message);
      if (error.result.details) {
        console.error(
          "Error details:",
          JSON.stringify(error.result.details, null, 2)
        );
      }
    }
  } else {
    console.error(`${context}:`, error);
  }

  throw error instanceof Error ? error : new Error(String(error));
}

export async function createOrder(
  options: CreateOrderOptions = {}
): Promise<unknown> {
  const {
    amount = "100.00",
    currencyCode = "USD",
    intent = CheckoutPaymentIntent.Capture,
    referenceId = "default",
    preferMinimalResponse = false
  } = options;

  try {
    const controller = getOrdersController();

    const createResponse = await controller.createOrder({
      body: {
        intent,
        purchaseUnits: [
          {
            referenceId,
            amount: {
              currencyCode,
              value: amount
            }
          }
        ]
      },
      prefer: preferMinimalResponse ? "return=minimal" : "return=representation"
    });

    return createResponse.result;
  } catch (error) {
    return handlePayPalError("Failed to create order", error);
  }
}

export async function getOrder(orderId: string): Promise<unknown> {
  if (!orderId) {
    throw new Error("orderId is required to retrieve an order.");
  }

  try {
    const controller = getOrdersController();
    const orderResponse = await controller.getOrder({ id: orderId });
    return orderResponse.result;
  } catch (error) {
    return handlePayPalError("Failed to retrieve order", error);
  }
}

async function runSample(): Promise<void> {
  if ((process.env.RUN_PAYPAL_ORDER_SAMPLE ?? "").toLowerCase() !== "true") {
    return;
  }

  const createdOrder = await createOrder();
  const createdOrderId =
    createdOrder && typeof createdOrder === "object"
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (createdOrder as any).id
      : undefined;

  if (!createdOrderId) {
    console.warn("Created order is missing an ID. Skipping retrieval step.");
    return;
  }

  const orderDetails = await getOrder(createdOrderId);

  console.log("Created order:", createdOrder);
  console.log("Retrieved order:", orderDetails);
}

void runSample();


