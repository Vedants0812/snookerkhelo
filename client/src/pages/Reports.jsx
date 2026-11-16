import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, money, plural, fmtTime, fmtDate, todayIST, mins, METHOD_LABEL } from '../api.js';
import { Loading, Empty, useLoad } from '../ui.jsx';

function downloadCsv(name, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob([`﻿${rows.map((r) => r.map(esc).join(',')).join('\r\n')}`], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Reports() {
  const [tab, setTab] = useState('daily');
  return (
    <>
      <div className="page-head"><div><h1>Reports</h1><p className="muted">Earnings in India time. Only the owner can see this page.</p></div></div>
      <div className="tabs">
        <button className={tab === 'daily' ? 'on' : ''} onClick={() => setTab('daily')}>Daily earnings</button>
        <button className={tab === 'range' ? 'on' : ''} onClick={() => setTab('range')}>Date range</button>
      </div>
      {tab === 'daily' ? <Daily /> : <Range />}
    </>
  );
}

function Daily() {
  const [date, setDate] = useState(todayIST());
  const { data: d, error } = useLoad(() => api(`/reports/daily?date=${date}`), [date], 30000);
  if (!d) return <Loading error={error} />;
  const { sales, collected } = d;

  const exportCsv = () => downloadCsv(`earnings-${d.date}.csv`, [
    ['Bill', 'Paid at', 'Table', 'Customer', 'Table charge', 'Snacks', 'Discount', 'Total', 'Payment'],
    ...d.bills.map((b) => [b.code, fmtTime(b.paidAt), b.tableName, b.customerName, b.tableCharge, b.itemsTotal, b.discount, b.total, METHOD_LABEL[b.paymentMethod]]),
    [], ['Sales total', sales.total], ['Cash collected', collected.cash], ['UPI collected', collected.upi], ['Card collected', collected.card],
    ['Pass top-ups', d.topups.total], ['Tournament fees', d.tournamentFees.total], ['Total money collected', collected.total],
  ]);

  return (
    <>
      <div className="toolbar">
        <input className="input" type="date" value={date} max={todayIST()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button className="btn" onClick={() => setDate(todayIST())}>Today</button>
        <button className="btn" onClick={() => setDate(todayIST(-1))}>Yesterday</button>
        <span className="spacer" />
        <button className="btn" onClick={exportCsv}>Export CSV</button>
        <button className="btn" onClick={() => window.print()}>Print</button>
      </div>

      <h3 className="section-title">{fmtDate(`${d.date}T12:00:00+05:30`)}</h3>
      <div className="stats">
        <div className="stat accent"><small>Money collected</small><strong>{money(collected.total)}</strong><span>cash + UPI + card received</span></div>
        <div className="stat"><small>Sales (paid bills)</small><strong>{money(sales.total)}</strong><span>{plural(sales.count, 'bill')} · {plural(d.sessions, 'session')}</span></div>
        <div className="stat"><small>Table income</small><strong>{money(sales.tableCharge)}</strong><span>{mins(d.playedMinutes)} played</span></div>
        <div className="stat"><small>Snacks income</small><strong>{money(sales.snacks)}</strong><span>discounts given {money(sales.discount)}</span></div>
        <div className={`stat ${d.outstanding.count ? 'warn' : ''}`}><small>Unpaid (all time)</small><strong>{money(d.outstanding.total)}</strong>
          <span><Link to="/bills">{plural(d.outstanding.count, 'bill')} pending</Link></span></div>
      </div>

      <div className="two-col">
        <section>
          <h3>Money collected</h3>
          <div className="table-wrap"><table className="data">
            <thead><tr><th>Source</th><th className="num">Cash</th><th className="num">UPI</th><th className="num">Card</th><th className="num">Total</th></tr></thead>
            <tbody>
              <tr><td>Bills</td><td className="num">{money(sales.byMethod.cash)}</td><td className="num">{money(sales.byMethod.upi)}</td><td className="num">{money(sales.byMethod.card)}</td>
                <td className="num">{money(sales.byMethod.cash + sales.byMethod.upi + sales.byMethod.card)}</td></tr>
              <tr><td>Pass top-ups</td><td className="num">{money(d.topups.cash)}</td><td className="num">{money(d.topups.upi)}</td><td className="num">{money(d.topups.card)}</td><td className="num">{money(d.topups.total)}</td></tr>
              <tr><td>Tournament fees</td><td className="num">{money(d.tournamentFees.cash)}</td><td className="num">{money(d.tournamentFees.upi)}</td><td className="num">{money(d.tournamentFees.card)}</td><td className="num">{money(d.tournamentFees.total)}</td></tr>
            </tbody>
            <tfoot><tr><td>Total</td><td className="num">{money(collected.cash)}</td><td className="num">{money(collected.upi)}</td><td className="num">{money(collected.card)}</td><td className="num">{money(collected.total)}</td></tr></tfoot>
          </table></div>
          <p className="muted small">Bills paid from Player Pass balance: {money(sales.byMethod.pass)} — already counted on the day the pass was topped up, so not added again here.</p>
        </section>

        <section>
          <h3>By table</h3>
          {d.tables.length === 0 ? <Empty>No table bills.</Empty> : (
            <div className="table-wrap"><table className="data">
              <thead><tr><th>Table</th><th className="num">Bills</th><th className="num">Played</th><th className="num">Table income</th></tr></thead>
              <tbody>{d.tables.map((t) => (
                <tr key={t.name}><td>{t.name}</td><td className="num">{t.bills}</td><td className="num">{mins(t.minutes)}{t.frames ? ` · ${t.frames}f` : ''}</td><td className="num">{money(t.tableCharge)}</td></tr>
              ))}</tbody>
            </table></div>
          )}
          {d.items.length > 0 && (
            <>
              <h3 className="section-title">Snacks sold</h3>
              <div className="table-wrap"><table className="data">
                <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Amount</th></tr></thead>
                <tbody>{d.items.map((i) => <tr key={i.name}><td>{i.name}</td><td className="num">{i.qty}</td><td className="num">{money(i.amount)}</td></tr>)}</tbody>
              </table></div>
            </>
          )}
        </section>
      </div>

      <h3 className="section-title">Paid bills</h3>
      {d.bills.length === 0 ? <Empty>No bills were paid on this day.</Empty> : (
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Bill</th><th>Paid</th><th>Table</th><th>Customer</th><th className="num">Table</th><th className="num">Snacks</th><th className="num">Disc.</th><th className="num">Total</th><th>Payment</th></tr></thead>
          <tbody>{d.bills.map((b) => (
            <tr key={b._id}><td><Link to={`/bills/${b._id}`}>{b.code}</Link></td><td>{fmtTime(b.paidAt)}</td><td>{b.tableName}</td><td>{b.customerName}</td>
              <td className="num">{money(b.tableCharge)}</td><td className="num">{money(b.itemsTotal)}</td><td className="num">{b.discount ? money(b.discount) : '—'}</td>
              <td className="num"><strong>{money(b.total)}</strong></td><td>{METHOD_LABEL[b.paymentMethod]}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

function Range() {
  const [from, setFrom] = useState(todayIST(-6));
  const [to, setTo] = useState(todayIST());
  const { data: d, error } = useLoad(() => api(`/reports/range?from=${from}&to=${to}`), [from, to]);
  const preset = (days) => { setFrom(todayIST(-(days - 1))); setTo(todayIST()); };
  const max = d ? Math.max(1, ...d.days.map((x) => x.collected)) : 1;

  return (
    <>
      <div className="toolbar">
        <input className="input" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="From" />
        <span className="muted">to</span>
        <input className="input" type="date" value={to} min={from} max={todayIST()} onChange={(e) => e.target.value && setTo(e.target.value)} aria-label="To" />
        <button className="btn" onClick={() => preset(7)}>7 days</button>
        <button className="btn" onClick={() => preset(30)}>30 days</button>
        <span className="spacer" />
        {d && <button className="btn" onClick={() => downloadCsv(`earnings-${from}-to-${to}.csv`, [
          ['Date', 'Bills', 'Sales', 'Table income', 'Snacks', 'Paid by pass', 'Pass top-ups', 'Tournament fees', 'Money collected'],
          ...d.days.map((x) => [x.date, x.bills, x.sales, x.tableCharge, x.snacks, x.passSpend, x.topups, x.fees, x.collected]),
        ])}>Export CSV</button>}
      </div>
      {!d ? <Loading error={error} /> : (
        <>
          <div className="stats">
            <div className="stat accent"><small>Money collected</small><strong>{money(d.totals.collected)}</strong><span>{d.days.length} days</span></div>
            <div className="stat"><small>Sales</small><strong>{money(d.totals.sales)}</strong><span>{plural(d.totals.bills, 'bill')}</span></div>
            <div className="stat"><small>Table income</small><strong>{money(d.totals.tableCharge)}</strong></div>
            <div className="stat"><small>Snacks income</small><strong>{money(d.totals.snacks)}</strong></div>
            <div className="stat"><small>Daily average</small><strong>{money(Math.round(d.totals.collected / d.days.length))}</strong></div>
          </div>
          <div className="table-wrap"><table className="data">
            <thead><tr><th>Date</th><th className="num">Bills</th><th className="num">Table</th><th className="num">Snacks</th><th className="num">Top-ups</th><th className="num">Fees</th><th className="num">Collected</th><th className="barcol" /></tr></thead>
            <tbody>{d.days.map((x) => (
              <tr key={x.date}>
                <td>{fmtDate(`${x.date}T12:00:00+05:30`)}</td><td className="num">{x.bills}</td><td className="num">{money(x.tableCharge)}</td><td className="num">{money(x.snacks)}</td>
                <td className="num">{x.topups ? money(x.topups) : '—'}</td><td className="num">{x.fees ? money(x.fees) : '—'}</td><td className="num"><strong>{money(x.collected)}</strong></td>
                <td className="barcol"><div className="bar" style={{ width: `${(x.collected / max) * 100}%` }} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        </>
      )}
    </>
  );
}
