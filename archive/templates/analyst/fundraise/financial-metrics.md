# Financial Metrics Reference

Key metrics VCs evaluate, formulas, and stage-specific benchmarks.

## Core Principle

**In 2025, capital efficiency trumps growth at all costs.** VCs are laser-focused on unit economics, sustainable growth, and clear paths to profitability. The frothy days of pre-revenue companies commanding sky-high multiples are over.

---

## Unit Economics

### Customer Acquisition Cost (CAC)

**Formula**:
```
CAC = Total Sales & Marketing Spend / Number of New Customers Acquired
```

**What to include**:
- Advertising spend
- Sales team salaries and commissions
- Marketing team salaries
- Marketing tools and software
- Content creation costs

**Segmented CAC** (more useful):
- CAC by channel (paid, organic, referral)
- CAC by customer segment (SMB, mid-market, enterprise)

### Lifetime Value (LTV)

**Simple Formula**:
```
LTV = ARPU × Gross Margin × Customer Lifetime
```

**SaaS Formula**:
```
LTV = (ARPU × Gross Margin) / Churn Rate
```

**Example**:
- ARPU: $100/month
- Gross Margin: 80%
- Monthly Churn: 2%
- LTV = ($100 × 0.80) / 0.02 = $4,000

### LTV:CAC Ratio

**Formula**:
```
LTV:CAC = Lifetime Value / Customer Acquisition Cost
```

**Benchmarks**:
| Ratio | Assessment |
|-------|------------|
| < 1:1 | Losing money on every customer |
| 1:1 - 2:1 | Unsustainable, needs improvement |
| 3:1 | Healthy baseline |
| 5:1+ | Excellent unit economics |
| > 10:1 | May be under-investing in growth |

**VC expectation**: 3:1 minimum for Series A, 5:1+ preferred

### CAC Payback Period

**Formula**:
```
Payback Period = CAC / (ARPU × Gross Margin)
```

**Benchmarks**:
| Payback | Assessment |
|---------|------------|
| < 12 months | Excellent |
| 12-18 months | Good |
| 18-24 months | Acceptable for enterprise |
| > 24 months | Concerning |

---

## Revenue Metrics

### Monthly Recurring Revenue (MRR)

**Components**:
```
MRR = New MRR + Expansion MRR - Churned MRR - Contraction MRR
```

**Types**:
- **New MRR**: Revenue from new customers
- **Expansion MRR**: Upsells and cross-sells
- **Churned MRR**: Lost revenue from cancellations
- **Contraction MRR**: Downgrades

### Annual Recurring Revenue (ARR)

**Formula**:
```
ARR = MRR × 12
```

**Note**: Only include truly recurring revenue. Exclude one-time fees, professional services (unless contracted recurring).

### Net Revenue Retention (NRR)

**Formula**:
```
NRR = (Starting MRR + Expansion - Churn - Contraction) / Starting MRR × 100
```

**Benchmarks**:
| NRR | Assessment |
|-----|------------|
| < 90% | Leaky bucket, fix retention |
| 90-100% | Stable, but limited growth |
| 100-110% | Good expansion motion |
| 110-130% | Excellent, customers grow with you |
| > 130% | World-class (rare) |

### Gross Revenue Retention (GRR)

**Formula**:
```
GRR = (Starting MRR - Churn - Contraction) / Starting MRR × 100
```

**Note**: GRR can never exceed 100%. It measures how well you keep existing revenue.

**Benchmark**: > 85% is healthy, > 90% is excellent

---

## Growth Metrics

### Month-over-Month Growth (MoM)

**Formula**:
```
MoM Growth = (Current Month Revenue - Previous Month Revenue) / Previous Month Revenue × 100
```

**Benchmarks**:
| MoM | Annual Equivalent | Assessment |
|-----|-------------------|------------|
| 5% | ~80% YoY | Solid |
| 10% | ~210% YoY | Strong |
| 15% | ~435% YoY | Exceptional |
| 20%+ | ~790% YoY | Hypergrowth |

### Year-over-Year Growth (YoY)

**Formula**:
```
YoY Growth = (Current Year Revenue - Previous Year Revenue) / Previous Year Revenue × 100
```

**Stage Expectations**:
| Stage | Expected YoY Growth |
|-------|---------------------|
| Pre-Seed/Seed | 200%+ (from low base) |
| Series A | 100-200% |
| Series B | 75-100% |
| Series C+ | 50-75% |

---

## Profitability Metrics

### Gross Margin

**Formula**:
```
Gross Margin = (Revenue - COGS) / Revenue × 100
```

**SaaS Benchmarks**:
| Margin | Assessment |
|--------|------------|
| < 60% | Services-heavy, scrutinize |
| 60-70% | Acceptable |
| 70-80% | Good |
| > 80% | Excellent |

### Burn Rate

**Formula**:
```
Monthly Burn = Monthly Expenses - Monthly Revenue
```

**Net Burn** (preferred metric):
```
Net Burn = Cash Out - Cash In
```

### Runway

**Formula**:
```
Runway (months) = Cash on Hand / Monthly Net Burn
```

**Best Practice**: Maintain 18-24 months runway at all times. Start raising with 9+ months left.

### Revenue Per Employee

**Formula**:
```
Revenue/Employee = ARR / Total Employees
```

**Benchmarks (2025)**:
| Stage | Revenue/Employee |
|-------|------------------|
| Seed | $50K-$100K |
| Series A | $100K-$200K |
| Series B+ | $150K-$300K |
| Efficient at scale | > $300K |

---

## Stage-Specific Benchmarks (2025)

### Seed Stage

| Metric | Target Range |
|--------|--------------|
| ARR | $150K-$500K (or strong usage) |
| MoM Growth | 15-20% |
| Burn Rate | $50K-$150K/month |
| Team Size | 3-8 people |
| Runway Need | 18-24 months |

**Valuation Multiples**: Often pre-revenue metrics used; if ARR exists, 20-40x ARR

**Median Round (2025)**: $2.5-3.2M at $14-17M pre-money

### Series A

| Metric | Target Range |
|--------|--------------|
| ARR | $1M-$3M+ |
| MoM Growth | 10-15% |
| LTV:CAC | > 3:1 |
| NRR | > 100% |
| Gross Margin | > 70% |
| CAC Payback | < 18 months |
| Team Size | 15-30 people |

**Valuation Multiples**: 3-10x ARR depending on growth and efficiency

**Median Round (2025)**: $7.9M at $10-30M valuation

### Series B

| Metric | Target Range |
|--------|--------------|
| ARR | $5M-$15M+ |
| YoY Growth | 100%+ |
| LTV:CAC | > 4:1 |
| NRR | > 110% |
| Gross Margin | > 75% |
| Path to profitability | Clear |

---

## Cohort Analysis

VCs love cohort data because it shows improvement over time.

### Revenue Cohorts
Track monthly cohorts showing:
- Month 1 revenue
- Retention at Month 3, 6, 12
- Expansion over time

### Usage Cohorts
Track engagement by signup cohort:
- DAU/MAU ratio by cohort
- Feature adoption curves
- Activation rates

**Key insight**: VCs want proof that retention and LTV improve as you scale.

---

## Financial Model Components

### What to Include

1. **Revenue Model**
   - Pricing tiers
   - Customer segments
   - Conversion rates
   - Expansion assumptions

2. **Cost Structure**
   - COGS breakdown
   - Headcount plan
   - Marketing spend
   - Infrastructure costs

3. **Unit Economics**
   - CAC by channel
   - LTV by segment
   - Payback period

4. **Projections**
   - 3-year P&L
   - Cash flow forecast
   - Key milestones

### Common Pitfalls

| Pitfall | Fix |
|---------|-----|
| Hockey stick without basis | Ground in current metrics |
| Ignoring churn | Model realistic retention |
| Linear cost scaling | Account for step functions |
| 100% of TAM | Use realistic penetration |

---

## Sources

- [The VC Factory - Unit Economics](https://thevcfactory.com/unit-economics/)
- [Carta - Series A Funding Guide](https://carta.com/learn/startups/fundraising/series-a/)
- [Abacum - Key Metrics Investors Watch](https://www.abacum.ai/blog/the-7-key-metrics-investors-will-be-watching-in-the-next-12-months)
- [Metal - 2025 SaaS Benchmarks](https://www.metal.so/collections/us-saas-seed-round-benchmarks-2025-average-round-size-valuations-dilution)
