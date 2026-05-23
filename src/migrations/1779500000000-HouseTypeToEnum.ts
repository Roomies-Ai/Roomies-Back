import { MigrationInterface, QueryRunner } from "typeorm";

export class HouseTypeToEnum1779500000000 implements MigrationInterface {
    name = 'HouseTypeToEnum1779500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."households_housetype_enum" AS ENUM('Apartment', 'Villa', 'Bungalow', 'Cottage', 'Townhouse', 'Chalet', 'Loft', 'Mansion', 'Duplex', 'Triplex', 'Quadplex', 'Studio', 'Other')`);
        await queryRunner.query(`ALTER TABLE "households" ADD "houseType" "public"."households_housetype_enum"`);
        // Migrate existing data: copy name from house_types into the new enum column
        await queryRunner.query(`
            UPDATE "households" h
            SET "houseType" = ht."name"::"public"."households_housetype_enum"
            FROM "house_types" ht
            WHERE h."houseTypeId" = ht."id"
              AND ht."name" IN ('Apartment', 'Villa', 'Bungalow', 'Cottage', 'Townhouse', 'Chalet', 'Loft', 'Mansion', 'Duplex', 'Triplex', 'Quadplex', 'Studio', 'Other')
        `);
        await queryRunner.query(`ALTER TABLE "households" DROP CONSTRAINT "FK_8cadafb7d81d2d118b553aae424"`);
        await queryRunner.query(`ALTER TABLE "households" DROP COLUMN "houseTypeId"`);
        await queryRunner.query(`DROP TABLE "house_types"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "house_types" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_f49fbd231de6818ac0f2c82211d" UNIQUE ("name"), CONSTRAINT "PK_17b989eaaf44d0176e95b591cc1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "households" ADD "houseTypeId" uuid`);
        await queryRunner.query(`ALTER TABLE "households" ADD CONSTRAINT "FK_8cadafb7d81d2d118b553aae424" FOREIGN KEY ("houseTypeId") REFERENCES "house_types"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "households" DROP COLUMN "houseType"`);
        await queryRunner.query(`DROP TYPE "public"."households_housetype_enum"`);
    }
}
