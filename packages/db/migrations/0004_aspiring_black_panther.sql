ALTER TABLE "islands" ADD COLUMN "wonder_level" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "islands" ADD COLUMN "wonder_wine_donated" numeric(20, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "islands" ADD COLUMN "wonder_marble_donated" numeric(20, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "islands" ADD COLUMN "wonder_crystal_donated" numeric(20, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "islands" ADD COLUMN "wonder_sulfur_donated" numeric(20, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "towns" ADD COLUMN "wonder_donated" numeric(20, 6) DEFAULT '0' NOT NULL;