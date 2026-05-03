import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrations1777840691212 implements MigrationInterface {
    name = 'Migrations1777840691212'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "telegramToken" character varying`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "UQ_5d03187613c5c33a458821cba6d" UNIQUE ("telegramToken")`);
        await queryRunner.query(`ALTER TABLE "users" ADD "telegramChatId" character varying`);
        await queryRunner.query(`ALTER TABLE "task_types" ALTER COLUMN "name" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "house_types" ALTER COLUMN "name" DROP NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "house_types" ALTER COLUMN "name" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "task_types" ALTER COLUMN "name" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "telegramChatId"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "UQ_5d03187613c5c33a458821cba6d"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "telegramToken"`);
    }

}
