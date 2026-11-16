import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { api, post, put, money, fmtDateTime, fmtTime, mins, waLink, METHOD_LABEL } from '../api.js';
import { Modal, Field, Loading, StatusBadge, PlayerPicker, PromptModal, useLoad, useAction } from '../ui.jsx';
import { useApp } from '../App.jsx';
import { upiLink } from '../../../shared/billing.js';

export default function BillView() {
  const { id } = useParams();
  const { settings, user } = useApp();
  const { data: bill, error, setData } = useLoad(() => api(`/bills/${id}`), [id]);
  const [qr, setQr] = useState('');
  const [passModal, setPassModal] = useState(false);
  const [ask, setAsk] = useState(''); // 'discount' | 'void'
  const [run, busy] = useAction();

  const link = bill && bill.status === 'unpaid' && bill.total > 0
    ? upiLink({ upiId: settings.upiId, payeeName: settings.upiPayeeName || settings.shopName, amount: bill.total, note: `Bill ${bill.code}` })
    : '';
  useEffect(() => {
    if (!link) { setQr(''); return; }
    QRCode.toDataURL(link, { width: 440, margin: 1, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(''));
  }, [link]);

  if (!bill) return <Loading error={error} />;

  const pay = (method, playerId) => run(async () => {
    setData(await post(`/bills/${bill._id}/pay`, { method, playerId }));
    setPassModal(false);
  }, 'Payment recorded');
  const saveDiscount = (v) => run(async () => { setData(await put(`/bills/${bill._id}`, { discount: Number(v) || 0 })); return true; }, 'Discount updated');
  const voidBill = (reason) => run(async () => { setData(await post(`/bills/${bill._id}/void`, { reason })); return true; }, 'Bill voided');

  const shareText = [
    `${settings.shopName} - Bill ${bill.code}`,
    bill.kind === 'table' ? `${bill.tableName}: ${money(bill.tableCharge)}` : null,
    bill.itemsTotal ? `Snacks: ${money(bill.itemsTotal)}` : null,
    bill.discount ? `Discount: -${money(bill.discount)}` : null,
    `Total: ${money(bill.total)}${bill.status === 'paid' ? ' (PAID)' : ''}`,
    settings.googleReviewLink ? `\nLoved your game? Rate us: ${settings.googleReviewLink}` : null,
  ].filter(Boolean).join('\n');

  return (
    <>
      <div className="page-head no-print">
        <div><h1>Bill {bill.code}</h1><p className="muted"><Link to="/bills">← All bills</Link></p></div>
        <div className="row gap wrap">
          {bill.player?.phone && <a className="btn" target="_blank" rel="noreferrer" href={waLink(bill.player.phone, shareText)}>WhatsApp bill</a>}
          <button className="btn" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      <div className="bill-layout">
        <div className="receipt">
          <div className="r-head">
            <h2>{settings.shopName}</h2>
            {settings.address && <p>{settings.address}</p>}
            {settings.phone && <p>Ph: {settings.phone}</p>}
          </div>
          <div className="r-meta">
            <span>Bill: <strong>{bill.code}</strong></span><span>{fmtDateTime(bill.createdAt)}</span>
            <span>Customer: {bill.customerName}</span><span>{bill.kind === 'table' ? bill.tableName : 'Counter sale'}</span>
          </div>
          <table className="r-lines">
            <thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amt</th></tr></thead>
            <tbody>
              {bill.kind === 'table' && (
                <tr>
                  <td>
                    {bill.mode === 'frame' ? 'Table (frames)' : 'Table time'}
                    <small>{fmtTime(bill.startedAt)} – {fmtTime(bill.endedAt)}{bill.mode === 'time' ? ` · played ${mins(bill.playedMinutes)}` : ''}</small>
                  </td>
                  <td>{bill.mode === 'frame' ? bill.frames : `${bill.billedMinutes}m`}</td>
                  <td>{bill.rate}{bill.mode === 'frame' ? '' : '/hr'}</td>
                  <td>{bill.tableCharge.toFixed(2)}</td>
                </tr>
              )}
              {bill.items.map((i) => (
                <tr key={i.name}><td>{i.name}</td><td>{i.qty}</td><td>{i.price}</td><td>{(i.amount ?? i.price * i.qty).toFixed(2)}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="r-totals">
            <div><span>Sub total</span><span>{bill.subTotal.toFixed(2)}</span></div>
            {bill.discount > 0 && <div><span>Discount</span><span>− {bill.discount.toFixed(2)}</span></div>}
            {bill.roundOff !== 0 && <div><span>Round off</span><span>{bill.roundOff > 0 ? '+' : ''}{bill.roundOff.toFixed(2)}</span></div>}
            <div className="grand"><span>TOTAL</span><span>{money(bill.total)}</span></div>
          </div>
          {bill.status === 'paid' && <div className="r-paid">PAID · {METHOD_LABEL[bill.paymentMethod]} · {fmtDateTime(bill.paidAt)}</div>}
          {bill.status === 'void' && <div className="r-paid void">VOID · {bill.voidReason}</div>}
          {qr && (
            <div className="r-qr">
              <img src={qr} alt={`UPI QR code to pay ${money(bill.total)}`} />
              <p>Scan with any UPI app to pay <strong>{money(bill.total)}</strong></p>
              <small>{settings.upiId}</small>
            </div>
          )}
          {settings.receiptFooter && <p className="r-foot">{settings.receiptFooter}</p>}
        </div>

        <div className="card pay-panel no-print">
          <div className="row between"><h3>Payment</h3><StatusBadge status={bill.status} /></div>
          <div className="pay-total">{money(bill.total)}</div>
          {bill.status === 'unpaid' && (
            <>
              {!settings.upiId && user.role === 'admin' && (
                <p className="muted small">Add your UPI ID in <Link to="/settings">Settings</Link> to print a payment QR on every bill.</p>
              )}
              <p className="muted small">Collect the money, then record how it was paid:</p>
              <div className="pay-buttons">
                <button className="btn primary" disabled={busy} onClick={() => pay('cash')}>Cash received</button>
                <button className="btn primary" disabled={busy} onClick={() => pay('upi')}>UPI received</button>
                <button className="btn" disabled={busy} onClick={() => pay('card')}>Card</button>
                {settings.features.playerPass && <button className="btn" disabled={busy} onClick={() => setPassModal(true)}>Player Pass</button>}
              </div>
              <button className="linkish" onClick={() => setAsk('discount')}>Change discount</button>
            </>
          )}
          {bill.status === 'paid' && <p className="muted">Paid by {METHOD_LABEL[bill.paymentMethod]} at {fmtTime(bill.paidAt)}{bill.paidBy ? ` · ${bill.paidBy.name}` : ''}</p>}
          {bill.status !== 'void' && user.role === 'admin' && <button className="linkish danger-text" onClick={() => setAsk('void')}>Void this bill</button>}
        </div>
      </div>

      {ask === 'discount' && (
        <PromptModal title={`Discount · ${bill.code}`} label="Discount amount (₹)" type="number" initial={bill.discount || 0}
          hint={`Sub total ${money(bill.subTotal)}. The discount can't be more than that.`} confirmLabel="Apply discount" onSubmit={saveDiscount} onClose={() => setAsk('')} />
      )}
      {ask === 'void' && (
        <PromptModal title={`Void bill ${bill.code}`} label="Reason" hint="This cannot be undone. Pass payments are refunded and snacks go back to stock."
          confirmLabel="Void bill" danger onSubmit={voidBill} onClose={() => setAsk('')} />
      )}
      {passModal && <PassPay bill={bill} busy={busy} onPay={(pid) => pay('pass', pid)} onClose={() => setPassModal(false)} />}
    </>
  );
}

function PassPay({ bill, busy, onPay, onClose }) {
  const [players, setPlayers] = useState(bill.player ? [bill.player] : []);
  const p = players[0];
  const short = p && p.passBalance < bill.total;
  return (
    <Modal title="Pay with Player Pass" onClose={onClose}>
      <Field label="Whose pass?"><PlayerPicker single showBalance selected={players} onChange={setPlayers} /></Field>
      {p && (
        <div className="summary">
          <div className="line"><span>Pass balance</span><strong>{money(p.passBalance)}</strong></div>
          <div className="line"><span>This bill</span><strong>− {money(bill.total)}</strong></div>
          <div className="line grand"><span>Balance after</span><strong className={short ? 'bad' : ''}>{money(p.passBalance - bill.total)}</strong></div>
        </div>
      )}
      {short && <div className="error">Not enough balance. <Link to={`/players/${p._id}`}>Top up the pass →</Link></div>}
      <div className="modal-foot">
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || !p || short} onClick={() => onPay(p._id)}>Deduct {money(bill.total)}</button>
      </div>
    </Modal>
  );
}
