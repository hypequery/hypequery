function isFilterCondition(obj) {
    return obj && 'column' in obj && 'operator' in obj && 'value' in obj;
}
function isFilterGroup(obj) {
    return obj && 'conditions' in obj && 'operator' in obj;
}
export class CrossFilteringFeature {
    builder;
    constructor(builder) {
        this.builder = builder;
    }
    applyCrossFilters(crossFilter) {
        const filterGroup = crossFilter.getConditions();
        if (filterGroup.conditions.length === 0) {
            return this.builder.getConfig();
        }
        if (filterGroup.operator === 'AND') {
            this.applyAndConditions(filterGroup.conditions);
        }
        else {
            this.builder.whereGroup(builder => {
                this.applyOrConditions(filterGroup.conditions, builder);
            });
        }
        return this.builder.getConfig();
    }
    applyAndConditions(conditions) {
        conditions.forEach(condition => {
            if (isFilterCondition(condition)) {
                this.builder.where(condition.column, condition.operator, condition.value);
            }
            else if (isFilterGroup(condition)) {
                if (condition.operator === 'AND') {
                    this.builder.whereGroup(builder => {
                        const feature = new CrossFilteringFeature(builder);
                        feature.applyAndConditions(condition.conditions);
                    });
                }
                else {
                    this.builder.whereGroup(builder => {
                        const feature = new CrossFilteringFeature(builder);
                        feature.applyOrConditions(condition.conditions, builder);
                    });
                }
            }
        });
    }
    applyOrConditions(conditions, builder = this.builder) {
        if (conditions.length === 0)
            return;
        const firstCondition = conditions[0];
        if (isFilterCondition(firstCondition)) {
            builder.where(firstCondition.column, firstCondition.operator, firstCondition.value);
        }
        else if (isFilterGroup(firstCondition)) {
            if (firstCondition.operator === 'AND') {
                builder.whereGroup(innerBuilder => {
                    const feature = new CrossFilteringFeature(innerBuilder);
                    feature.applyAndConditions(firstCondition.conditions);
                });
            }
            else {
                builder.whereGroup(innerBuilder => {
                    const feature = new CrossFilteringFeature(innerBuilder);
                    feature.applyOrConditions(firstCondition.conditions, innerBuilder);
                });
            }
        }
        for (let i = 1; i < conditions.length; i++) {
            const condition = conditions[i];
            if (isFilterCondition(condition)) {
                builder.orWhere(condition.column, condition.operator, condition.value);
            }
            else if (isFilterGroup(condition)) {
                if (condition.operator === 'AND') {
                    builder.orWhereGroup(innerBuilder => {
                        const feature = new CrossFilteringFeature(innerBuilder);
                        feature.applyAndConditions(condition.conditions);
                    });
                }
                else {
                    builder.orWhereGroup(innerBuilder => {
                        const feature = new CrossFilteringFeature(innerBuilder);
                        feature.applyOrConditions(condition.conditions, innerBuilder);
                    });
                }
            }
        }
    }
}
