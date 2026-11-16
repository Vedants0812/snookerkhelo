// Demo data for a client walkthrough: tables, snacks, a few players and a tournament.
// Safe to re-run: it only adds things that are missing. Stop the dev server first when
// using the built-in local database (it can only be opened by one process).
import { connectDb, closeDb } from './db.js';
import { Table, Product, Player, Tournament, getSettings } from './models.js';

await connectDb();
await getSettings();

if (!(await Table.exists({}))) {
  await Table.insertMany([
    { name: 'Snooker 1', type: 'snooker', ratePerHour: 200, ratePerFrame: 80, defaultMode: 'time', sortOrder: 1 },
    { name: 'Snooker 2', type: 'snooker', ratePerHour: 200, ratePerFrame: 80, defaultMode: 'time', sortOrder: 2 },
    { name: 'Pool 1', type: 'pool', ratePerHour: 150, ratePerFrame: 40, defaultMode: 'time', sortOrder: 3 },
    { name: 'Pool 2', type: 'pool', ratePerHour: 150, ratePerFrame: 40, defaultMode: 'frame', sortOrder: 4 },
  ]);
  console.log('added 4 tables (placeholder rates - change them in Settings)');
}

if (!(await Product.exists({}))) {
  await Product.insertMany([
    { name: 'Water Bottle', category: 'Drinks', price: 20 },
    { name: 'Cold Drink 250ml', category: 'Drinks', price: 25, stock: 48 },
    { name: 'Energy Drink', category: 'Drinks', price: 125, stock: 12 },
    { name: 'Tea', category: 'Drinks', price: 15 },
    { name: 'Coffee', category: 'Drinks', price: 25 },
    { name: 'Chips', category: 'Snacks', price: 20, stock: 30 },
    { name: 'Maggi', category: 'Snacks', price: 50 },
    { name: 'Sandwich', category: 'Snacks', price: 60 },
    { name: 'Chalk', category: 'Accessories', price: 30, stock: 20 },
  ]);
  console.log('added snack menu');
}

if (!(await Player.exists({}))) {
  const players = await Player.insertMany([
    { name: 'Rohit Sharma', phone: '9812345601' },
    { name: 'Imran Khan', phone: '9812345602' },
    { name: 'Vikas Patil', phone: '9812345603' },
    { name: 'Sameer Shaikh', phone: '9812345604' },
  ]);
  if (!(await Tournament.exists({}))) {
    const t = await Tournament.create({
      name: 'Weekend 8-Ball Championship', game: '8 Ball Pool', entryFee: 200, maxPlayers: 16,
      prize: 'Winner Rs. 2000 + trophy', date: new Date(Date.now() + 7 * 86400000),
      description: 'Knockout format, race to 3 frames.',
      registrations: players.map((p) => ({ name: p.name, phone: p.phone, player: p._id })),
    });
    console.log(`added demo players and tournament "${t.name}"`);
  }
}

await closeDb();
console.log('seed complete');
process.exit(0);
