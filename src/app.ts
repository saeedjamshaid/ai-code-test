import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  CustomError,
  Environment,
  LogLevel,
  OrdersController,
} from '@paypal/paypal-server-sdk';

// Initialize the PayPal client
const client = new Client({
  clientCredentialsAuthCredentials: {
    oAuthClientId: 'AcYwRJcoVwp5oNkwPbIHGxISi6uVcR1elF7TBlf_hJMZUhOdDZEUy6F4GOHIPcD1PNgJbSW7EIHZsRcx',
    oAuthClientSecret: 'EHgRtJ9wG0ZXrrhhVPS6gHl9S54VkpZurQH-PWXEPTC912dsrwjP4itL1KEp5VBe1hDwe5aLl3DlpRcD'
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

export const ordersController = new OrdersController(client);

/**
 * Creates an order
 * @param amount - The order amount
 * @param currencyCode - The currency code (default: USD)
 * @returns Order creation response
 */
export async function createOrder(amount: string = '100.00', currencyCode: string = 'USD') {
  try {
    const createOrderRequest = {
      body: {
        intent: CheckoutPaymentIntent.Capture,
        purchaseUnits: [
          {
            amount: {
              currencyCode,
              value: amount,
            },
          }
        ],
      },
      prefer: 'return=representation' as const
    };

    const createOrderResponse = await ordersController.createOrder(createOrderRequest);
    return createOrderResponse.result;
  } catch (error) {
    if (error instanceof ApiError) {
      console.error('Error creating order:', error.statusCode, error.body);
      if (error instanceof CustomError) {
        console.error('Custom Error:', error.result?.name, error.result?.message);
      }
    } else {
      console.error('Unexpected Error creating order:', error);
    }
    throw error;
  }
}

/**
 * Retrieves order details by order ID
 * @param orderId - The PayPal order ID
 * @returns Order details
 */
export async function getOrder(orderId: string) {
  try {
    const getOrderRequest = {
      id: orderId,
      // Optional: specify fields to return, or omit for full order details
    };

    const orderResponse = await ordersController.getOrder(getOrderRequest);
    return orderResponse.result;
  } catch (error) {
    if (error instanceof ApiError) {
      console.error('Error retrieving order:', error.statusCode, error.body);
      if (error instanceof CustomError) {
        console.error('Custom Error:', error.result?.name, error.result?.message);
      }
    } else {
      console.error('Unexpected Error retrieving order:', error);
    }
    throw error;
  }
}

export async function createAndCaptureOrder() {
  try {
    // Create an order
    const createOrderRequest = {
      body: {
        intent: CheckoutPaymentIntent.Capture,
        purchaseUnits: [
          {
            amount: {
              currencyCode: 'USD',
              value: '100.00',
            },
          }
        ],
      },
      prefer: 'return=representation' // Get full response to access links
    };

    const createOrderResponse = await ordersController.createOrder(createOrderRequest);
    const orderId = createOrderResponse.result.id;
    
    if (!orderId) {
      throw new Error('Order ID is missing from create order response');
    }
    
    console.log('Order Created:', orderId);
    console.log('Order Status:', createOrderResponse.result.status);

    // Get order details using the order ID
    console.log('\n📋 Retrieving order details...');
    const orderDetails = await getOrder(orderId);
    console.log('✅ Order Retrieved Successfully!');
    console.log('Order ID:', orderDetails.id);
    console.log('Order Status:', orderDetails.status);
    console.log('Intent:', orderDetails.intent);
    if (orderDetails.purchaseUnits && orderDetails.purchaseUnits.length > 0) {
      const purchaseUnit = orderDetails.purchaseUnits[0];
      if (purchaseUnit) {
        console.log('Amount:', purchaseUnit.amount?.value, purchaseUnit.amount?.currencyCode);
        console.log('Reference ID:', purchaseUnit.referenceId);
      }
    }
    if (orderDetails.createTime) {
      console.log('Created At:', orderDetails.createTime);
    }
    if (orderDetails.updateTime) {
      console.log('Updated At:', orderDetails.updateTime);
    }
    if (orderDetails.links && orderDetails.links.length > 0) {
      console.log('Available Links:');
      orderDetails.links.forEach(link => {
        console.log(`  - ${link.rel}: ${link.href} (${link.method})`);
      });
    }

    // Check for approve URL in the response links
    const approveLink = createOrderResponse.result.links?.find(
      link => link.rel === 'approve'
    );
    
    if (approveLink) {
      console.log('\n⚠️  Order requires payer approval.');
      console.log('Approve URL:', approveLink.href);
      console.log('\nFor automated testing, providing payment_source in capture request...\n');
    }

  //   // Capture the order with payment_source for automated testing
  //   // Using a PayPal sandbox test card for server-side testing
  //   const captureOrderRequest = {
  //     id: orderId,
  //     body: {
  //       paymentSource: {
  //         card: {
  //           number: '4032034814971974', // PayPal sandbox test card
  //           expiry: '2025-12', // Future expiry date
  //           securityCode: '123', // CVV
  //           name: 'Test User'
  //         }
  //       }
  //     },
  //     prefer: 'return=representation'
  //   };

  //   const captureOrderResponse = await ordersController.captureOrder(captureOrderRequest);
  //   console.log('✅ Order Captured Successfully!');
  //   console.log('Capture ID:', captureOrderResponse.result.id);
  //   console.log('Capture Status:', captureOrderResponse.result.status);
    
  //   if (captureOrderResponse.result.purchaseUnits?.[0]?.payments?.captures?.[0]) {
  //     const capture = captureOrderResponse.result.purchaseUnits[0].payments.captures[0];
  //     console.log('Capture Amount:', capture.amount?.value, capture.amount?.currencyCode);
  //   }

  } catch (error) {
    if (error instanceof ApiError) {
      console.error('\n❌ API Error:', error.statusCode);
      console.error('Error Body:', JSON.stringify(error.body, null, 2));
      if (error instanceof CustomError) {
        console.error('Error Name:', error.result?.name);
        console.error('Error Message:', error.result?.message);
        if (error.result?.details) {
          console.error('Error Details:', error.result.details);
        }
      }
    } else {
      console.error('❌ Unexpected Error:', error);
    }
    throw error; // Re-throw to allow caller to handle
  }
}