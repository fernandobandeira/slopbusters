# Examples

Before/after examples to model review suggestions on. They are in TypeScript for illustration; apply the same ideas in whatever language you are reviewing, using its idioms.

## The onion: the business rule on top, details below

**Before.** The handler mixes the business rule with parsing, math, and I/O. You have to read every line to learn what an order checkout actually does.

```ts
async function checkout(req: Request) {
  const body = JSON.parse(req.body);
  if (!body.items || body.items.length === 0) throw new Error("empty cart");
  let total = 0;
  for (const item of body.items) {
    const product = await db.query("SELECT * FROM products WHERE id = $1", [item.id]);
    if (product.stock < item.qty) throw new Error(`out of stock: ${item.id}`);
    total += product.price * item.qty;
  }
  if (body.coupon) {
    const c = await db.query("SELECT * FROM coupons WHERE code = $1", [body.coupon]);
    if (c && c.expiresAt > Date.now()) total = total * (1 - c.percent / 100);
  }
  const charge = await stripe.charges.create({ amount: Math.round(total * 100), customer: body.customerId });
  await mailer.send(body.email, "Order confirmed", `Charged ${total}`);
  return { chargeId: charge.id };
}
```

**After.** The top level states the business rule. Each step is one layer down, and you only open it when you need its details.

```ts
async function checkout(req: Request) {
  const order = parseOrder(req);

  const items = await reserveItems(order.items);
  const total = await applyCoupon(subtotal(items), order.coupon);
  const charge = await chargeCustomer(order.customerId, total);
  await sendConfirmation(order.email, total);

  return { chargeId: charge.id };
}

async function applyCoupon(amount: Money, code?: string): Promise<Money> {
  if (!code) return amount;

  const coupon = await coupons.findValid(code);
  return coupon ? coupon.applyTo(amount) : amount;
}
```

## Guard clauses instead of nesting

**Before**

```ts
function shippingCost(order: Order) {
  if (order) {
    if (order.items.length > 0) {
      if (!order.isDigital) {
        return order.weight > 10 ? HEAVY_RATE : STANDARD_RATE;
      }
    }
  }
  return 0;
}
```

**After**

```ts
function shippingCost(order: Order) {
  if (order.items.length === 0 || order.isDigital) return 0;

  return order.weight > HEAVY_THRESHOLD_KG ? HEAVY_RATE : STANDARD_RATE;
}
```

## Boolean flag parameters

**Before.** The flag means the function does two things, and the call site `exportReport(data, true)` tells the reader nothing.

```ts
function exportReport(data: Report, asCsv: boolean) { ... }
```

**After**

```ts
function exportReportAsCsv(data: Report) { ... }
function exportReportAsPdf(data: Report) { ... }
```

## Name the condition

**Before**

```ts
if (user.role === "admin" || (user.plan === "enterprise" && user.seats > 0 && !user.suspended)) { ... }
```

**After**

```ts
if (canManageBilling(user)) { ... }
```

## Over-fragmentation (when *not* to extract)

A function whose name only restates its body adds a jump and hides nothing. Suggest inlining it.

```ts
function addOne(n: number) { return n + 1; }   // inline this
function isAdult(person: Person) { return person.age >= LEGAL_AGE; }   // keep: it names a business rule
```

## Arrange-Act-Assert

**Before.** The phases are tangled, the name says nothing, and two behaviors are tested at once.

```ts
test("order", async () => {
  const repo = new InMemoryOrders();
  const service = new OrderService(repo);
  const order = await service.place({ items: [{ id: "a", qty: 1 }] });
  expect(order.status).toBe("placed");
  await service.cancel(order.id);
  expect((await repo.get(order.id)).status).toBe("cancelled");
});
```

**After.** One behavior per test, a name that states the behavior, and blank lines separating Arrange, Act, and Assert.

```ts
test("cancelling a placed order marks it as cancelled", async () => {
  const repo = new InMemoryOrders();
  const service = new OrderService(repo);
  const order = await service.place(anOrder());

  await service.cancel(order.id);

  expect((await repo.get(order.id)).status).toBe("cancelled");
});
```
