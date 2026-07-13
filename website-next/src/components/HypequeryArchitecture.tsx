'use client';

import { Database, Shield, Users, Code, Activity, BarChart3, Bot, Briefcase, Cog, Globe, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import Image from 'next/image';

export default function HypequeryArchitecture() {
  const consumers = [
    { icon: Bot, label: 'AI Agents', color: 'text-cyan-400' },
    { icon: BarChart3, label: 'Dashboards', color: 'text-purple-400' },
    { icon: Cog, label: 'Backend Jobs', color: 'text-emerald-400' },
    { icon: Briefcase, label: 'SaaS Products', color: 'text-rose-400' },
  ];

  const executionLayer = [
    { icon: Globe, label: 'APIs' },
    { icon: Activity, label: 'In-process' },
    { icon: Code, label: 'React hooks' },
  ];

  const coreFeatures = [
    { icon: Shield, label: 'Authentication' },
    { icon: Users, label: 'Multi-tenancy' },
    { icon: Code, label: 'Type-safe' },
  ];

  return (
    <div className="w-full py-16 px-4">
      {/* Title */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-100px' }}
        transition={{ duration: 0.6 }}
        className="text-center mb-16"
      >
        <p className="text-sm font-semibold uppercase tracking-wide text-indigo-500">
          Architecture
        </p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          The complete analytics layer
        </h2>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">
          Define metrics once. Execute across your entire stack.
        </p>
      </motion.div>

      {/* Horizontal Stack Diagram */}
      <div className="flex flex-col lg:flex-row items-stretch justify-center gap-8 lg:gap-6">
        {/* ClickHouse Layer */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="w-full lg:w-64 flex-shrink-0"
        >
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-6 bg-white dark:bg-gray-800 shadow-lg h-full">
            <div className="flex flex-col items-center gap-4">
              <div className="p-4 bg-gray-100 dark:bg-gray-900 rounded-lg">
                <Database className="size-10 text-amber-500" />
              </div>
              <div className="text-center">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">ClickHouse</h3>
                <p className="text-gray-500 dark:text-gray-400 text-xs">OLAP database</p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Arrow */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.4, delay: 0.5 }}
          className="hidden lg:flex items-center"
        >
          <ArrowRight className="size-8 text-gray-400 dark:text-gray-600" />
        </motion.div>

        {/* hypequery Layer - WIDEST */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6, delay: 0.7 }}
          className="w-full lg:flex-1 lg:max-w-2xl"
        >
          <div className="border border-indigo-500/30 rounded-lg p-8 bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950/30 dark:to-gray-800 shadow-xl h-full">
            <div className="flex items-center justify-center gap-3 mb-8">
              <Image
                src="/logo.svg"
                alt="hypequery"
                width={32}
                height={32}
                className="dark:invert"
              />
              <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">hypequery</h3>
            </div>

            {/* Core Features */}
            <div className="space-y-5 mb-8">
              <div className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">
                Core
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {coreFeatures.map((feature, index) => (
                  <motion.div
                    key={feature.label}
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true, margin: '-100px' }}
                    transition={{ duration: 0.4, delay: 0.8 + index * 0.1 }}
                  >
                    <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900/50 p-5 h-full">
                      <div className="flex flex-col items-center gap-3 text-center">
                        <feature.icon className="size-6 text-indigo-500" />
                        <span className="text-gray-700 dark:text-gray-200 text-sm font-medium">{feature.label}</span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Execution Layer */}
            <div className="space-y-5">
              <div className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">
                Execution
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {executionLayer.map((feature, index) => (
                  <motion.div
                    key={feature.label}
                    initial={{ opacity: 0 }}
                    whileInView={{ opacity: 1 }}
                    viewport={{ once: true, margin: '-100px' }}
                    transition={{ duration: 0.4, delay: 1.1 + index * 0.1 }}
                  >
                    <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900/50 p-5 h-full">
                      <div className="flex flex-col items-center gap-3 text-center">
                        <feature.icon className="size-6 text-blue-500" />
                        <span className="text-gray-700 dark:text-gray-200 text-sm font-medium">{feature.label}</span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>

        {/* Arrow */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.4, delay: 1.4 }}
          className="hidden lg:flex items-center"
        >
          <ArrowRight className="size-8 text-gray-400 dark:text-gray-600" />
        </motion.div>

        {/* Consumers Layer */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6, delay: 1.5 }}
          className="w-full lg:w-80 flex-shrink-0"
        >
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-6 bg-white dark:bg-gray-800 shadow-lg h-full">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-5 text-center uppercase tracking-wider">
              Consumers
            </h3>
            <div className="grid grid-cols-2 gap-4">
              {consumers.map((consumer, index) => (
                <motion.div
                  key={consumer.label}
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true, margin: '-100px' }}
                  transition={{ duration: 0.4, delay: 1.6 + index * 0.1 }}
                >
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900/50 p-5">
                    <div className="flex flex-col items-center gap-3 text-center">
                      <consumer.icon className={`size-6 ${consumer.color}`} />
                      <span className="text-gray-700 dark:text-gray-200 text-sm font-medium">{consumer.label}</span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Bottom Text */}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: '-100px' }}
        transition={{ duration: 0.6, delay: 2 }}
        className="text-center mt-12"
      >
        <p className="text-gray-600 dark:text-gray-400 text-base max-w-3xl mx-auto leading-relaxed">
          Define once, execute everywhere. hypequery provides the complete analytics layer
          from database to production—authentication, type safety, and multi-tenant execution
          across APIs, jobs, and React apps.
        </p>
      </motion.div>
    </div>
  );
}
