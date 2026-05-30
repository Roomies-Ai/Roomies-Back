import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGoogleCalendarFields1780000000000 implements MigrationInterface {
  name = 'AddGoogleCalendarFields1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "googleAccessToken" character varying`);
    await queryRunner.query(`ALTER TABLE "users" ADD "googleRefreshToken" character varying`);
    await queryRunner.query(`ALTER TABLE "users" ADD "googleTokenExpiresAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "users" ADD "calendarSyncEnabled" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD "googleCalendarEventId" character varying`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "googleCalendarEventId"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "calendarSyncEnabled"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "googleTokenExpiresAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "googleRefreshToken"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "googleAccessToken"`);
  }
}
