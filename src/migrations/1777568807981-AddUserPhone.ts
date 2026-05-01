import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserPhone1777568807981 implements MigrationInterface {
    name = 'AddUserPhone1777568807981'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "phoneNumber" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "phoneNumber"`);
    }

}
