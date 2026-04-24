import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { type Employee, Role } from '../../time-off/domain/time-off.types';

@Injectable()
export class EmployeeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Employee | null> {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
    });

    if (!employee) {
      return null;
    }

    return {
      id: employee.id,
      name: employee.name,
      email: employee.email,
      role: employee.role as Role,
      createdAt: employee.createdAt,
      updatedAt: employee.updatedAt,
    };
  }
}
