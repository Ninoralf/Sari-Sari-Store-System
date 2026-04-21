function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysAgo(amount) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - amount);
  return toIsoDate(date);
}

export const seedInventoryItems = [
  { name: "Lucky Me Pancit Canton - Chilimansi", category: "Noodles", supplier: "Monde Nissin Distributor", stockQuantity: 45, unitPrice: 10.5, sellingPrice: 13, reorderLevel: 20 },
  { name: "Argentina Corned Beef 175g", category: "Canned Goods", supplier: "Century Pacific Supplier", stockQuantity: 15, unitPrice: 32, sellingPrice: 38, reorderLevel: 20 },
  { name: "Alaska Condensada 300ml", category: "Milk & Dairy", supplier: "Alaska Milk Distributor", stockQuantity: 0, unitPrice: 28, sellingPrice: 32, reorderLevel: 15 },
  { name: "Coca-Cola 1.5L", category: "Beverages", supplier: "Coca-Cola Bottlers", stockQuantity: 32, unitPrice: 45, sellingPrice: 55, reorderLevel: 15 },
  { name: "C2 Green Tea 1L", category: "Beverages", supplier: "Universal Robina Supplier", stockQuantity: 18, unitPrice: 28, sellingPrice: 35, reorderLevel: 20 },
  { name: "Eden Cheese 165g", category: "Dairy", supplier: "Mondelez Distributor", stockQuantity: 25, unitPrice: 65, sellingPrice: 75, reorderLevel: 10 },
  { name: "Century Tuna Flakes 155g", category: "Canned Goods", supplier: "Century Pacific Supplier", stockQuantity: 40, unitPrice: 28, sellingPrice: 33, reorderLevel: 20 },
  { name: "Skyflakes Crackers 250g", category: "Snacks", supplier: "Monde Nissin Distributor", stockQuantity: 55, unitPrice: 22, sellingPrice: 28, reorderLevel: 25 },
  { name: "Bear Brand Powdered Milk 300g", category: "Milk & Dairy", supplier: "Nestle Distributor", stockQuantity: 12, unitPrice: 125, sellingPrice: 145, reorderLevel: 15 },
  { name: "Surf Powder Detergent 30g", category: "Household", supplier: "Unilever Supplier", stockQuantity: 75, unitPrice: 5, sellingPrice: 7, reorderLevel: 50 },
  { name: "Colgate Toothpaste 150g", category: "Personal Care", supplier: "Colgate-Palmolive Supplier", stockQuantity: 8, unitPrice: 58, sellingPrice: 68, reorderLevel: 10 },
  { name: "Chippy BBQ 110g", category: "Snacks", supplier: "Jack 'n Jill Distributor", stockQuantity: 60, unitPrice: 18, sellingPrice: 23, reorderLevel: 30 }
];

export const seedSales = [
  { date: daysAgo(0), paymentMethod: "Cash", items: [{ itemName: "Lucky Me Pancit Canton - Chilimansi", quantity: 3, price: 13 }, { itemName: "Coca-Cola 1.5L", quantity: 2, price: 55 }] },
  { date: daysAgo(0), paymentMethod: "GCash", items: [{ itemName: "Century Tuna Flakes 155g", quantity: 2, price: 33 }, { itemName: "Skyflakes Crackers 250g", quantity: 1, price: 28 }, { itemName: "Eden Cheese 165g", quantity: 1, price: 75 }] },
  { date: daysAgo(0), paymentMethod: "Cash", items: [{ itemName: "Chippy BBQ 110g", quantity: 5, price: 23 }] },
  { date: daysAgo(1), paymentMethod: "Cash", items: [{ itemName: "Lucky Me Pancit Canton - Chilimansi", quantity: 10, price: 13 }, { itemName: "Coca-Cola 1.5L", quantity: 3, price: 55 }, { itemName: "C2 Green Tea 1L", quantity: 2, price: 35 }] },
  { date: daysAgo(1), paymentMethod: "GCash", items: [{ itemName: "Century Tuna Flakes 155g", quantity: 4, price: 33 }, { itemName: "Argentina Corned Beef 175g", quantity: 2, price: 38 }] },
  { date: daysAgo(2), paymentMethod: "Cash", items: [{ itemName: "Chippy BBQ 110g", quantity: 8, price: 23 }, { itemName: "Skyflakes Crackers 250g", quantity: 5, price: 28 }] }
];
