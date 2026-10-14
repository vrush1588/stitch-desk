const STORAGE_KEY = "stitch-desk.orders";
const DRAFT_KEY = "stitch-desk.order-draft";

export function getOrderDraft() {
  try {
    const storedDraft = localStorage.getItem(DRAFT_KEY);
    return storedDraft === null ? null : JSON.parse(storedDraft);
  } catch (error) {
    throw new Error(`Unable to load the order in progress: ${error.message}`);
  }
}

export function saveOrderDraft(draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch (error) {
    throw new Error(`Unable to save the order in progress: ${error.message}`);
  }
}

export function clearOrderDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch (error) {
    throw new Error(`Unable to clear the order in progress: ${error.message}`);
  }
}

export function getOrders() {
  try {
    const storedOrders = localStorage.getItem(STORAGE_KEY);
    if (storedOrders === null) {
      return [];
    }

    const orders = JSON.parse(storedOrders);
    if (!Array.isArray(orders)) {
      throw new Error("Saved order data has an invalid format.");
    }

    return orders;
  } catch (error) {
    throw new Error(`Unable to load saved orders: ${error.message}`);
  }
}

export function saveOrder(order) {
  try {
    const savedOrder = {
      ...order,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      status: "New",
      created_at: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...getOrders(), savedOrder]));
    return savedOrder;
  } catch (error) {
    throw new Error(`Unable to save this order: ${error.message}`);
  }
}

export function updateOrder(id, updates) {
  try {
    const orders = getOrders();
    if (!orders.some((order) => order.id === id)) {
      throw new Error("This order could not be found.");
    }
    const updatedOrders = orders.map((order) =>
      order.id === id ? { ...order, ...updates } : order,
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedOrders));
    return updatedOrders.find((order) => order.id === id);
  } catch (error) {
    throw new Error(`Unable to update this order: ${error.message}`);
  }
}

export function deleteOrder(id) {
  try {
    const orders = getOrders();
    if (!orders.some((order) => order.id === id)) {
      throw new Error("This order could not be found.");
    }
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(orders.filter((order) => order.id !== id)),
    );
  } catch (error) {
    throw new Error(`Unable to delete this order: ${error.message}`);
  }
}
