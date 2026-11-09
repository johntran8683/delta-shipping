import { NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service';

type PrismaStub = {
  customer: { findUnique: jest.Mock };
  shipToLocation: { findFirst: jest.Mock };
  customerCarrierAccount: {
    create: jest.Mock;
    update: jest.Mock;
    findFirst: jest.Mock;
  };
};

function makeService() {
  const prisma: PrismaStub = {
    customer: { findUnique: jest.fn() },
    shipToLocation: { findFirst: jest.fn() },
    customerCarrierAccount: {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn(),
    },
  };
  const service = new CustomersService(prisma as never);
  // create/update return the refreshed customer; stub that read.
  (service as unknown as { getCustomer: jest.Mock }).getCustomer = jest
    .fn()
    .mockResolvedValue({ stubbed: true });
  return { service, prisma };
}

describe('createCarrierAccount — ship-to location', () => {
  it('stores the account on the location when it belongs to the customer', async () => {
    const { service, prisma } = makeService();
    prisma.customer.findUnique.mockResolvedValue({ id: 'cust-1' });
    prisma.shipToLocation.findFirst.mockResolvedValue({ id: 'loc-1' });

    await service.createCarrierAccount('cust-1', {
      carrier_code: 'FEDEX',
      account_number: '123456789',
      ship_to_location_id: 'loc-1',
    });

    expect(prisma.shipToLocation.findFirst).toHaveBeenCalledWith({
      where: { id: 'loc-1', customer_id: 'cust-1' },
      select: { id: true },
    });
    expect(prisma.customerCarrierAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customer_id: 'cust-1',
        carrier_code: 'FEDEX',
        account_number: '123456789',
        ship_to_location_id: 'loc-1',
      }),
    });
  });

  it('stores a customer-wide account when no location is given', async () => {
    const { service, prisma } = makeService();
    prisma.customer.findUnique.mockResolvedValue({ id: 'cust-1' });

    await service.createCarrierAccount('cust-1', {
      carrier_code: 'UPS',
      account_number: 'UPS999',
    });

    expect(prisma.shipToLocation.findFirst).not.toHaveBeenCalled();
    expect(prisma.customerCarrierAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ship_to_location_id: null }),
    });
  });

  it('refuses a location of another customer', async () => {
    const { service, prisma } = makeService();
    prisma.customer.findUnique.mockResolvedValue({ id: 'cust-1' });
    prisma.shipToLocation.findFirst.mockResolvedValue(null);

    await expect(
      service.createCarrierAccount('cust-1', {
        carrier_code: 'FEDEX',
        account_number: '123456789',
        ship_to_location_id: 'loc-9',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.customerCarrierAccount.create).not.toHaveBeenCalled();
  });
});

describe('updateCarrierAccount — ship-to location', () => {
  function setup() {
    const { service, prisma } = makeService();
    prisma.customerCarrierAccount.findFirst.mockResolvedValue({
      id: 'acct-1',
      customer_id: 'cust-1',
    });
    return { service, prisma };
  }

  it('moves the account to a location of the same customer', async () => {
    const { service, prisma } = setup();
    prisma.shipToLocation.findFirst.mockResolvedValue({ id: 'loc-1' });

    await service.updateCarrierAccount('cust-1', 'acct-1', {
      ship_to_location_id: 'loc-1',
    });

    expect(prisma.customerCarrierAccount.update).toHaveBeenCalledWith({
      where: { id: 'acct-1' },
      data: expect.objectContaining({
        ship_to_location: { connect: { id: 'loc-1' } },
      }),
    });
  });

  it('clears the location (back to customer-wide) on null', async () => {
    const { service, prisma } = setup();

    await service.updateCarrierAccount('cust-1', 'acct-1', {
      ship_to_location_id: null,
    });

    expect(prisma.shipToLocation.findFirst).not.toHaveBeenCalled();
    expect(prisma.customerCarrierAccount.update).toHaveBeenCalledWith({
      where: { id: 'acct-1' },
      data: expect.objectContaining({
        ship_to_location: { disconnect: true },
      }),
    });
  });

  it('refuses a location of another customer', async () => {
    const { service, prisma } = setup();
    prisma.shipToLocation.findFirst.mockResolvedValue(null);

    await expect(
      service.updateCarrierAccount('cust-1', 'acct-1', {
        ship_to_location_id: 'loc-9',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.customerCarrierAccount.update).not.toHaveBeenCalled();
  });
});
