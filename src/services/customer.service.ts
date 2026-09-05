import { Customer } from '../models/Customer';
import { CustomerAddress } from '../models/CustomerAddress';
import { Order } from '../models/Order';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';

export async function listCustomers(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    Customer.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    Customer.countDocuments(filter),
  ]);
  return { items, total };
}

async function findCustomerOrThrow(id: string) {
  const customer = await Customer.findById(id);
  if (!customer) throw ApiError.notFound('Customer not found', 'CUSTOMER_NOT_FOUND');
  return customer;
}

export async function getCustomerById(id: string) {
  return findCustomerOrThrow(id);
}

export async function updateCustomer(id: string, data: Record<string, unknown>) {
  const customer = await findCustomerOrThrow(id);
  Object.assign(customer, data);
  await customer.save();
  return customer;
}

export async function deleteCustomer(id: string) {
  const customer = await findCustomerOrThrow(id);
  await CustomerAddress.deleteMany({ customerId: id });
  await customer.deleteOne();
}

export async function updateCustomerStatus(id: string, status: string) {
  return updateCustomer(id, { status });
}

export async function getCustomerDashboard(id: string) {
  await findCustomerOrThrow(id);

  const [orderCount, addressCount, customer] = await Promise.all([
    Order.countDocuments({ customerId: id }),
    CustomerAddress.countDocuments({ customerId: id }),
    Customer.findById(id),
  ]);

  return {
    orderCount,
    addressCount,
    walletBalance: customer?.walletBalance ?? 0,
    status: customer?.status,
  };
}
